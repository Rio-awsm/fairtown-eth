// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {LotFactory} from "./LotFactory.sol";
import {IChainTrigger} from "./ChainTrigger.sol";
import {LotToken} from "./tokens/LotToken.sol";
import {PriceMath} from "./libraries/PriceMath.sol";
import {Keys} from "./libraries/Keys.sol";

interface IDisputeResolver {
    function openNoShowRuling(
        uint256 lotId,
        address buyer,
        uint256 tokenAmount,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external returns (uint256 disputeId);
}

/// @title MarketSettlement
/// @notice Recipient of every auction. Fee, tier advance, held money, QR handover, no-show refunds, relists and the
///         seller record (contract 7.5). Every lot state has a timeout and a money outcome:
///         sold -> handover | no-show (contest window) | silence (report window) -> all held money resolved.
/// @dev Invariants: at settle `advance + fee + held == raised`; afterwards every held unit goes to the seller
///      (handover, release, dust) or back to a buyer (no-show), so `seller + buyers + treasury == raised`.
// Reentrancy lints are scoped off for this contract only. Every function that calls out is `nonReentrant` and
// ordered checks-effects-interactions (state and events first, token transfers last). The lint still flags
// (a) ReentrancyGuard's own `_status` reset after the body and (b) SignatureChecker's ERC-1271 staticcall.
// The few calls that must come first return values we need: the CCA sweeps (amounts), the immutable resolver
// (dispute id) and the immutable LotFactory (relisted lot id). Reviewed in S1 1.3; recheck on any change.
// forge-lint: disable-start(reentrancy-no-eth, reentrancy-events)
contract MarketSettlement is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant HANDOVER_TYPEHASH =
        keccak256("Handover(uint256 lotId,address buyer,uint256 tokenAmount,uint64 expiryBlock)");
    /// @notice Tokens left below this (CCA round-down dust, 1e-6 of a unit) count as fully handed over.
    uint256 public constant TOKEN_DUST = 1e12;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant BPS = 10_000;

    // Indexes into LOT_STATUS (@fairtown/shared/keys).
    uint8 internal constant OPEN = 0;
    uint8 internal constant UNSOLD = 1;
    uint8 internal constant SOLD = 2;
    uint8 internal constant TRUCK_BOOKED = 3;
    uint8 internal constant PICKED_UP = 4;
    uint8 internal constant PAID_IN_FULL = 5;
    uint8 internal constant DELIVERED = 6;
    uint8 internal constant NO_SHOW_REPORTED = 7;
    uint8 internal constant DISPUTED = 8;
    uint8 internal constant REFUNDED = 9;
    uint8 internal constant RELISTED = 10;

    struct Params {
        uint16 feeBps;
        uint16 advanceNewBps;
        uint16 advanceProvenBps;
        uint16 advanceTruckBps;
        uint32 provenAfter;
        uint64 contestWindowBlocks;
        uint64 reportWindowBlocks;
    }

    struct Sale {
        bool settled;
        bool released; // report window closed and silent buyers' share paid out
        bool complete; // every held unit resolved
        bool anyRefund; // a buyer got money back, so the lot is not clean
        bool paidInFull;
        bool unsoldResolved; // relisted or reclaimed
        uint8 status;
        uint16 advanceBps;
        uint64 pickupDeadline;
        address seller;
        address currency;
        address token;
        address carrier;
        bytes32 sector;
        uint256 parentLotId;
        uint256 truckLotId;
        uint256 soldTokens;
        uint256 heldRemaining; // currency still held for this lot
        uint256 outstanding; // sold tokens not yet handed over or refunded (includes reported ones)
        uint256 reportedTokens; // escrowed under an open no-show report
        uint256 unsold;
    }

    struct Settled {
        uint256 finalClearingPerUnit;
        uint256 raised;
        uint256 advance;
        uint256 held;
        uint256 fee;
    }

    struct Report {
        bool open;
        bool contested;
        uint64 contestEnds;
        uint256 tokens;
        uint256 disputeId;
    }

    struct Record {
        uint32 cleanLots;
        uint32 noShows;
        uint32 openNoShows;
        bool marked; // seeded by the operator, disclosed
    }

    LotFactory public immutable factory;
    IChainTrigger public immutable trigger;
    address public immutable resolver; // DisputeResolver, or address(0) before S1 4.1
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint16 public immutable advanceNewBps;
    uint16 public immutable advanceProvenBps;
    uint16 public immutable advanceTruckBps;
    uint32 public immutable provenAfter;
    uint64 public immutable contestWindowBlocks;
    uint64 public immutable reportWindowBlocks;

    mapping(uint256 lotId => Sale) internal _sales;
    mapping(uint256 lotId => mapping(address buyer => Report)) internal _reports;
    mapping(address seller => Record) internal _records;
    mapping(bytes32 digest => bool) public ticketUsed;

    event LotSettled(
        uint256 indexed lotId,
        uint256 finalClearingPerUnit,
        uint256 avgPerUnit,
        uint256 soldUnits,
        uint256 raised,
        uint256 sellerPaid,
        uint256 held,
        uint256 fee,
        uint16 advanceBps,
        uint64 pickupDeadline
    );
    event LotRelisted(uint256 indexed lotId, uint256 indexed newLotId, uint256 newFloorPerUnit);
    event CarrierAssigned(uint256 indexed lotId, uint256 indexed truckLotId, address indexed carrier);
    event HandoverConfirmed(
        uint256 indexed lotId,
        address indexed buyer,
        address indexed receiver,
        uint256 tokenAmount,
        uint256 releasedToSeller
    );
    event LotPaidInFull(uint256 indexed lotId);
    event LotDelivered(uint256 indexed lotId, uint256 truckLotId);
    event NoShowReported(uint256 indexed lotId, address indexed buyer, uint256 tokenAmount, uint64 contestEnds);
    event NoShowContested(uint256 indexed lotId, address indexed buyer, uint256 indexed disputeId);
    event NoShowRefunded(uint256 indexed lotId, address indexed seller, address indexed buyer, uint256 refund);
    event HeldReleased(uint256 indexed lotId, uint256 amount);
    event RulingSettled(uint256 indexed lotId, address indexed buyer, uint256 refundToBuyer, uint256 paidToSeller);
    event SellerRecordUpdated(address indexed seller, uint32 cleanLots, uint32 noShows, bool proven);

    error ZeroAddress();
    error BadParams();
    error AlreadySettled(uint256 lotId);
    error AuctionNotOver(uint256 lotId, uint64 endBlock);
    error NotSold(uint256 lotId);
    error NotSeller(address caller);
    error NotSellerOrOperator(address caller);
    error NotBuyerOrCarrier(address caller);
    error NotResolver(address caller);
    error NoResolver();
    error HeldAlreadyReleased(uint256 lotId);
    error TicketExpired(uint64 expiryBlock);
    error TicketAlreadyUsed(bytes32 digest);
    error BadSignature();
    error NoShowOpen(uint256 lotId, address buyer);
    error ZeroAmount();
    error AmountTooHigh(uint256 amount, uint256 available);
    error TooEarly(uint64 opensAfterBlock);
    error WindowClosed(uint64 closedAfterBlock);
    error AlreadyReported(uint256 lotId, address buyer);
    error NoOpenReport(uint256 lotId, address buyer);
    error AlreadyContested(uint256 lotId, address buyer);
    error Contested(uint256 lotId, address buyer);
    error CarrierAlreadyAssigned(uint256 lotId);
    error TruckNotSold(uint256 truckLotId);
    error NotATruckLot(uint256 truckLotId);
    error ParentMismatch(uint256 lotId, uint256 truckParentLotId);
    error LotClosed(uint256 lotId);
    error NothingUnsold(uint256 lotId);
    error FloorNotLower(uint256 newFloor, uint256 oldFloor);
    error NotImplemented();

    /// @param factory_ LotFactory. @param trigger_ ChainTrigger. Both are deployed against this contract's
    ///        predicted address (D-41), so all three hold each other immutably.
    constructor(
        address admin,
        LotFactory factory_,
        IChainTrigger trigger_,
        // forge-lint: disable-next-line(missing-zero-check) zero is valid until DisputeResolver exists (S1 4.1)
        address resolver_,
        address treasury_,
        Params memory p
    ) EIP712("Fairtown", "1") {
        if (
            admin == address(0) || address(factory_) == address(0) || address(trigger_) == address(0)
                || treasury_ == address(0)
        ) revert ZeroAddress();
        if (
            p.feeBps > BPS || p.advanceNewBps > BPS || p.advanceProvenBps > BPS || p.advanceTruckBps > BPS
                || p.contestWindowBlocks == 0 || p.reportWindowBlocks <= p.contestWindowBlocks
        ) revert BadParams();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        factory = factory_;
        trigger = trigger_;
        resolver = resolver_;
        treasury = treasury_;
        feeBps = p.feeBps;
        advanceNewBps = p.advanceNewBps;
        advanceProvenBps = p.advanceProvenBps;
        advanceTruckBps = p.advanceTruckBps;
        provenAfter = p.provenAfter;
        contestWindowBlocks = p.contestWindowBlocks;
        reportWindowBlocks = p.reportWindowBlocks;
    }

    // ================================================================== sale

    /// @notice Anyone, once, at or after endBlock. Sweeps the auction and pays fee and advance; the rest is held.
    function settle(uint256 lotId) external nonReentrant {
        Sale storage s = _sales[lotId];
        if (s.settled) revert AlreadySettled(lotId);
        LotFactory.Lot memory lot = factory.getLot(lotId);
        if (block.number < lot.endBlock) revert AuctionNotOver(lotId, lot.endBlock);
        s.settled = true;
        s.seller = lot.spec.seller;
        s.currency = lot.spec.currency;
        s.token = lot.token;
        s.sector = lot.spec.sector;
        s.parentLotId = lot.spec.parentLotId;

        Settled memory m;
        // The sweep must come first: the amounts it returns decide everything below. The auction is CCA code
        // deployed by our factory, the currency is allowlisted, and every entry point here is nonReentrant.
        (m.raised, m.finalClearingPerUnit) = _sweep(s, IContinuousClearingAuction(lot.auction));

        s.advanceBps = advanceBpsFor(s.seller, s.sector);
        (m.fee, m.advance, m.held) = PriceMath.splitPayout(m.raised, feeBps, s.advanceBps);
        if (s.soldTokens == 0 && m.held > 0) {
            // Cannot happen with CCA (raised implies cleared tokens); never leave money behind if it did.
            m.advance += m.held;
            m.held = 0;
        }
        s.heldRemaining = m.held;
        s.outstanding = s.soldTokens;
        // forge-lint: disable-next-line(unsafe-typecast) block numbers and windows fit uint64
        s.pickupDeadline = uint64(block.number) + lot.spec.pickupWindowBlocks;
        s.status = s.soldTokens > 0 ? SOLD : UNSOLD;
        if (s.soldTokens == 0) s.complete = true; // nothing held, nothing to hand over

        _emitSettled(lotId, s, m);
        trigger.onSettled(lotId); // immutable ChainTrigger; reads final state through heldOf
        if (m.fee > 0) IERC20(s.currency).safeTransfer(treasury, m.fee);
        if (m.advance > 0) IERC20(s.currency).safeTransfer(s.seller, m.advance);
    }

    function _sweep(Sale storage s, IContinuousClearingAuction a)
        internal
        returns (uint256 raised, uint256 finalClearingPerUnit)
    {
        IERC20 cur = IERC20(s.currency);
        IERC20 tok = IERC20(s.token);
        uint256 curBefore = cur.balanceOf(address(this));
        uint256 tokBefore = tok.balanceOf(address(this));
        a.sweepCurrency();
        a.sweepUnsoldTokens();
        raised = cur.balanceOf(address(this)) - curBefore;
        s.unsold = tok.balanceOf(address(this)) - tokBefore;
        // forge-lint: disable-next-line(unused-return)
        s.soldTokens = a.totalCleared();
        finalClearingPerUnit = PriceMath.fromQ96(a.clearingPrice());
    }

    function _emitSettled(uint256 lotId, Sale storage s, Settled memory m) internal {
        uint256 avgPerUnit = s.soldTokens > 0 ? Math.mulDiv(m.raised, UNIT, s.soldTokens) : 0;
        uint256 soldUnits = Math.ceilDiv(s.soldTokens, UNIT); // whole units, rounded up (D-42)
        emit LotSettled(
            lotId,
            m.finalClearingPerUnit,
            avgPerUnit,
            soldUnits,
            m.raised,
            m.advance,
            m.held,
            m.fee,
            s.advanceBps,
            s.pickupDeadline
        );
    }

    /// @notice Seller or operator relists the unsold whole units at a strictly lower floor, as a new lot and token.
    function relist(uint256 lotId, uint256 newFloorPerUnit, uint64 durationBlocks)
        external
        nonReentrant
        returns (uint256 newLotId)
    {
        Sale storage s = _sales[lotId];
        if (msg.sender != s.seller && !hasRole(OPERATOR_ROLE, msg.sender)) revert NotSellerOrOperator(msg.sender);
        uint256 units = _takeUnsold(lotId, s);
        LotFactory.LotSpec memory spec = factory.getLot(lotId).spec;
        if (newFloorPerUnit >= spec.floorPerUnit) revert FloorNotLower(newFloorPerUnit, spec.floorPerUnit);
        spec.qty = units;
        spec.floorPerUnit = newFloorPerUnit;
        spec.durationBlocks = durationBlocks;
        spec.parentLotId = lotId;
        if (s.soldTokens == 0) s.status = RELISTED;
        // The new lot id comes back from the immutable LotFactory; unsold tokens were burned above.
        // forge-lint: disable-next-line(unused-return)
        (newLotId,,) = factory.createRelistedLot(spec);
        emit LotRelisted(lotId, newLotId, newFloorPerUnit);
    }

    /// @notice Seller closes the unsold supply: tokens are burned (D-43), the seller keeps the goods.
    function reclaimUnsold(uint256 lotId) external nonReentrant {
        Sale storage s = _sales[lotId];
        if (msg.sender != s.seller) revert NotSeller(msg.sender);
        _takeUnsold(lotId, s);
    }

    /// @dev Burns all unsold tokens once. Returns the whole units available to relist.
    function _takeUnsold(uint256 lotId, Sale storage s) internal returns (uint256 units) {
        if (!s.settled) revert NotSold(lotId);
        if (s.unsoldResolved || s.unsold == 0) revert NothingUnsold(lotId);
        units = s.unsold / UNIT;
        s.unsoldResolved = true;
        LotToken(s.token).burnFrom(address(this), s.unsold);
    }

    // ================================================================== transport

    /// @notice Anyone. The truck lot must be settled and sold, and chained to this lot as its direct parent.
    function assignCarrier(uint256 lotId, uint256 truckLotId) external nonReentrant {
        Sale storage p = _sales[lotId];
        if (!p.settled || p.soldTokens == 0) revert NotSold(lotId);
        if (p.complete || p.released) revert LotClosed(lotId);
        if (p.carrier != address(0)) revert CarrierAlreadyAssigned(lotId);
        Sale storage t = _sales[truckLotId];
        if (!t.settled || t.soldTokens == 0) revert TruckNotSold(truckLotId);
        if (!Keys.isTruck(t.sector)) revert NotATruckLot(truckLotId);
        if (t.parentLotId != lotId) revert ParentMismatch(lotId, t.parentLotId);
        p.carrier = t.seller;
        p.truckLotId = truckLotId;
        p.status = TRUCK_BOOKED;
        emit CarrierAssigned(lotId, truckLotId, t.seller);
    }

    // ================================================================== handover

    function handoverDigest(uint256 lotId, address buyer, uint256 tokenAmount, uint64 expiryBlock)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(HANDOVER_TYPEHASH, lotId, buyer, tokenAmount, expiryBlock)));
    }

    /// @notice The buyer or the assigned carrier submits the seller's signed ticket. Burns the buyer's lot tokens
    ///         and pays the seller that share of the held money.
    function confirmHandover(
        uint256 lotId,
        address buyer,
        uint256 tokenAmount,
        uint64 expiryBlock,
        bytes calldata sellerSig
    ) external nonReentrant {
        Sale storage s = _sales[lotId];
        if (!s.settled || s.soldTokens == 0) revert NotSold(lotId);
        if (s.released || s.complete) revert HeldAlreadyReleased(lotId);
        if (block.number > expiryBlock) revert TicketExpired(expiryBlock);
        bool byCarrier = msg.sender != buyer && msg.sender == s.carrier && s.carrier != address(0);
        if (msg.sender != buyer && !byCarrier) revert NotBuyerOrCarrier(msg.sender);
        if (_reports[lotId][buyer].open) revert NoShowOpen(lotId, buyer);
        if (tokenAmount == 0) revert ZeroAmount();
        uint256 free = s.outstanding - s.reportedTokens;
        if (tokenAmount > free) revert AmountTooHigh(tokenAmount, free);

        bytes32 digest = handoverDigest(lotId, buyer, tokenAmount, expiryBlock);
        if (ticketUsed[digest]) revert TicketAlreadyUsed(digest);
        if (!SignatureChecker.isValidSignatureNow(s.seller, digest, sellerSig)) revert BadSignature();

        // Effects
        ticketUsed[digest] = true;
        uint256 pay = _share(s, tokenAmount);
        s.heldRemaining -= pay;
        s.outstanding -= tokenAmount;
        emit HandoverConfirmed(lotId, buyer, msg.sender, tokenAmount, pay);
        if (byCarrier) {
            s.status = PICKED_UP; // delivered later, on the truck lot's drop-off scan
        } else if (Keys.isTruck(s.sector) && s.parentLotId != 0) {
            s.status = DELIVERED;
            _sales[s.parentLotId].status = DELIVERED;
            emit LotDelivered(s.parentLotId, lotId);
        } else {
            s.status = DELIVERED;
            emit LotDelivered(lotId, 0);
        }
        pay += _maybeComplete(lotId);

        // Interactions
        LotToken(s.token).burnFrom(buyer, tokenAmount);
        if (pay > 0) IERC20(s.currency).safeTransfer(s.seller, pay);
    }

    // ================================================================== no-show

    /// @notice Buyer, after the pickup deadline and within the report window. Escrows the buyer's tokens.
    function reportNoShow(uint256 lotId, uint256 tokenAmount) external nonReentrant {
        Sale storage s = _sales[lotId];
        if (!s.settled || s.soldTokens == 0) revert NotSold(lotId);
        if (s.released || s.complete) revert HeldAlreadyReleased(lotId);
        if (block.number <= s.pickupDeadline) revert TooEarly(s.pickupDeadline);
        uint64 reportEnds = s.pickupDeadline + reportWindowBlocks;
        if (block.number > reportEnds) revert WindowClosed(reportEnds);
        Report storage r = _reports[lotId][msg.sender];
        if (r.open) revert AlreadyReported(lotId, msg.sender);
        if (tokenAmount == 0) revert ZeroAmount();
        uint256 free = s.outstanding - s.reportedTokens;
        if (tokenAmount > free) revert AmountTooHigh(tokenAmount, free);

        // forge-lint: disable-next-line(unsafe-typecast) block numbers fit uint64
        uint64 contestEnds = uint64(block.number) + contestWindowBlocks;
        _reports[lotId][msg.sender] =
            Report({open: true, contested: false, contestEnds: contestEnds, tokens: tokenAmount, disputeId: 0});
        s.reportedTokens += tokenAmount;
        _records[s.seller].openNoShows++;
        s.status = NO_SHOW_REPORTED;
        emit NoShowReported(lotId, msg.sender, tokenAmount, contestEnds);

        LotToken(s.token).escrowFrom(msg.sender, tokenAmount);
    }

    /// @notice Seller, within the contest window: hands the case to the DisputeResolver (CRE W3, S1 4.1).
    function contestNoShow(uint256 lotId, address buyer, bytes32 evidenceHash, string calldata evidenceURI)
        external
        nonReentrant
    {
        Sale storage s = _sales[lotId];
        if (msg.sender != s.seller) revert NotSeller(msg.sender);
        Report storage r = _reports[lotId][buyer];
        if (!r.open) revert NoOpenReport(lotId, buyer);
        if (r.contested) revert AlreadyContested(lotId, buyer);
        if (block.number > r.contestEnds) revert WindowClosed(r.contestEnds);
        if (resolver == address(0)) revert NoResolver();
        r.contested = true;
        s.status = DISPUTED;
        // The dispute id comes back from the immutable resolver, so the call must precede the last two effects.
        uint256 disputeId =
            IDisputeResolver(resolver).openNoShowRuling(lotId, buyer, r.tokens, evidenceHash, evidenceURI);
        r.disputeId = disputeId;
        emit NoShowContested(lotId, buyer, disputeId);
    }

    /// @notice Anyone, after an uncontested contest window: refunds the buyer's held share and marks the seller.
    function finalizeNoShow(uint256 lotId, address buyer) external nonReentrant {
        Sale storage s = _sales[lotId];
        Report storage r = _reports[lotId][buyer];
        if (!r.open) revert NoOpenReport(lotId, buyer);
        if (r.contested) revert Contested(lotId, buyer);
        if (block.number <= r.contestEnds) revert TooEarly(r.contestEnds);

        uint256 tokens = r.tokens;
        uint256 refund = _share(s, tokens);
        r.open = false;
        s.heldRemaining -= refund;
        s.outstanding -= tokens;
        s.reportedTokens -= tokens;
        s.anyRefund = true;
        s.status = REFUNDED;

        Record storage rec = _records[s.seller];
        rec.openNoShows--;
        rec.noShows++;
        rec.cleanLots = 0;
        rec.marked = false;
        emit NoShowRefunded(lotId, s.seller, buyer, refund);
        emit SellerRecordUpdated(s.seller, rec.cleanLots, rec.noShows, _isProven(rec));
        uint256 dust = _maybeComplete(lotId);

        LotToken(s.token).burnFrom(address(this), tokens);
        if (refund > 0) IERC20(s.currency).safeTransfer(buyer, refund);
        if (dust > 0) IERC20(s.currency).safeTransfer(s.seller, dust);
    }

    /// @notice Anyone, after the report window: the share of buyers who neither picked up nor reported goes to the
    ///         seller. Money under an open report or ruling stays held.
    function releaseExpired(uint256 lotId) external nonReentrant {
        Sale storage s = _sales[lotId];
        if (!s.settled || s.soldTokens == 0) revert NotSold(lotId);
        if (s.released || s.complete) revert HeldAlreadyReleased(lotId);
        uint64 reportEnds = s.pickupDeadline + reportWindowBlocks;
        if (block.number <= reportEnds) revert TooEarly(reportEnds);

        uint256 free = s.outstanding - s.reportedTokens;
        uint256 amount = _share(s, free);
        s.heldRemaining -= amount;
        s.outstanding = s.reportedTokens;
        s.released = true;
        if (s.reportedTokens == 0) s.status = PICKED_UP; // SoT 8.6: buyer silent, held goes to seller
        emit HeldReleased(lotId, amount);
        amount += _maybeComplete(lotId);

        if (amount > 0) IERC20(s.currency).safeTransfer(s.seller, amount);
    }

    // ================================================================== rulings

    /// @notice CRE W3 ruling, via DisputeResolver. Implemented in S1 4.1.
    function resolveRuling(uint256, address, uint256, uint16) external view {
        if (msg.sender != resolver || resolver == address(0)) revert NotResolver(msg.sender);
        revert NotImplemented();
    }

    // ================================================================== completion

    /// @dev Held share for `tokens` of what is still outstanding. The last one takes the remainder (dust).
    function _share(Sale storage s, uint256 tokens) internal view returns (uint256) {
        if (tokens >= s.outstanding) return s.heldRemaining;
        return Math.mulDiv(s.heldRemaining, tokens, s.outstanding);
    }

    /// @dev State and events only. Returns rounding dust the caller must pay the seller (SoT: dust goes to the
    ///      seller on the final release).
    function _maybeComplete(uint256 lotId) internal returns (uint256 dust) {
        Sale storage s = _sales[lotId];
        if (s.complete || s.reportedTokens != 0 || s.outstanding > TOKEN_DUST) return 0;
        s.complete = true;
        s.outstanding = 0;
        dust = s.heldRemaining;
        if (dust > 0) {
            s.heldRemaining = 0;
            emit HeldReleased(lotId, dust);
        }
        if (!s.anyRefund) {
            Record storage rec = _records[s.seller];
            rec.cleanLots++;
            emit SellerRecordUpdated(s.seller, rec.cleanLots, rec.noShows, _isProven(rec));
        }
        _maybePaidInFull(lotId);
        if (Keys.isTruck(s.sector) && s.parentLotId != 0 && _sales[s.parentLotId].truckLotId == lotId) {
            _maybePaidInFull(s.parentLotId);
        }
    }

    /// @dev Paid in full: all held money went to the seller, and to the carrier too if one was assigned (D-44).
    function _maybePaidInFull(uint256 lotId) internal {
        Sale storage s = _sales[lotId];
        if (!s.complete || s.paidInFull || s.anyRefund) return;
        if (s.carrier != address(0)) {
            Sale storage t = _sales[s.truckLotId];
            if (!t.complete || t.anyRefund) return;
        }
        s.paidInFull = true;
        s.status = PAID_IN_FULL;
        emit LotPaidInFull(lotId);
    }

    // ================================================================== seller record

    /// @notice Operator marks seeded demo sellers as proven (disclosed, D-26).
    function markProven(address seller, bool proven) external onlyRole(OPERATOR_ROLE) {
        if (seller == address(0)) revert ZeroAddress();
        Record storage rec = _records[seller];
        rec.marked = proven;
        emit SellerRecordUpdated(seller, rec.cleanLots, rec.noShows, _isProven(rec));
    }

    function _isProven(Record storage rec) internal view returns (bool) {
        return rec.marked || (rec.cleanLots >= provenAfter && rec.openNoShows == 0);
    }

    function advanceBpsFor(address seller, bytes32 sector) public view returns (uint16) {
        if (Keys.isTruck(sector)) return advanceTruckBps;
        return _isProven(_records[seller]) ? advanceProvenBps : advanceNewBps;
    }

    function sellerRecord(address seller) external view returns (uint32 cleanLots, uint32 noShows, bool proven) {
        Record storage rec = _records[seller];
        return (rec.cleanLots, rec.noShows, _isProven(rec));
    }

    // ================================================================== views

    function heldOf(uint256 lotId)
        external
        view
        returns (uint256 held, uint256 soldTokens, uint64 pickupDeadline, address carrier)
    {
        Sale storage s = _sales[lotId];
        return (s.heldRemaining, s.soldTokens, s.pickupDeadline, s.carrier);
    }

    /// @notice Index into LOT_STATUS. Unsettled lots read 0 (open).
    function statusOf(uint256 lotId) external view returns (uint8) {
        return _sales[lotId].status;
    }

    function reportOf(uint256 lotId, address buyer)
        external
        view
        returns (bool open, bool contested, uint64 contestEnds, uint256 tokens, uint256 disputeId)
    {
        Report storage r = _reports[lotId][buyer];
        return (r.open, r.contested, r.contestEnds, r.tokens, r.disputeId);
    }

    function saleOf(uint256 lotId) external view returns (Sale memory) {
        return _sales[lotId];
    }
}
// forge-lint: disable-end(reentrancy-no-eth, reentrancy-events)
