// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReceiverBase} from "./ReceiverBase.sol";
import {LotFactory} from "../LotFactory.sol";
import {LotToken} from "../tokens/LotToken.sol";

/// @notice What the resolver needs from MarketSettlement.
interface ISettlementRulings {
    function onDisputeOpened(uint256 lotId, address buyer, uint256 tokenAmount) external;
    function resolveRuling(uint256 lotId, address buyer, uint256 tokenAmount, uint16 refundBps) external;
}

// Reentrancy lints are scoped off for this contract, as for MarketSettlement (contracts/NOTES.md, S1 1.3): every
// entry point is nonReentrant, state and events come before the calls, and the only callees are the immutable
// settlement and our LotToken. The lint still counts OZ ReentrancyGuard's own `_status` reset.
// forge-lint: disable-start(reentrancy-no-eth, reentrancy-events)
/// @title DisputeResolver
/// @notice CRE receiver for W3 rulings, contract section 7.8. Quality disputes are opened here by the buyer, who
///         escrows the disputed tokens; contested no-shows are opened by MarketSettlement, which already holds the
///         tokens. W3 reports abi.encode(uint256 disputeId, uint16 refundBps, bytes32 reasonHash) and the ruling is
///         settled in MarketSettlement. Every dispute ends: a ruling, or after `rulingTimeoutBlocks` anyone can expire
///         it, which settles with no refund (D-65, SoT 10: "never a default refund").
contract DisputeResolver is ReceiverBase, ReentrancyGuard {
    uint8 public constant KIND_QUALITY = 0;
    uint8 public constant KIND_NO_SHOW = 1;
    uint16 internal constant BPS = 10_000;

    struct Dispute {
        uint256 lotId;
        address buyer;
        uint8 kind;
        bool open;
        uint64 openedBlock;
        uint256 tokenAmount;
    }

    ISettlementRulings public immutable settlement;
    LotFactory public immutable factory;
    uint64 public immutable rulingTimeoutBlocks;

    uint256 public disputeCount;
    mapping(uint256 disputeId => Dispute) internal _disputes;

    event DisputeOpened(
        uint256 indexed disputeId,
        uint256 indexed lotId,
        address indexed buyer,
        uint8 kind,
        uint256 tokenAmount,
        bytes32 evidenceHash,
        string evidenceURI
    );
    event DisputeResolved(uint256 indexed disputeId, uint256 indexed lotId, uint16 refundBps, bytes32 reasonHash);
    event DisputeExpired(uint256 indexed disputeId, uint256 indexed lotId);

    error NotSettlement(address caller);
    error DisputeNotOpen(uint256 disputeId);
    error BadRefundBps(uint16 refundBps);
    error TooEarly(uint64 expiresAfterBlock);
    error ZeroTimeout();

    /// @param settlement_ MarketSettlement, which in turn holds this contract's (predicted) address immutably (D-41).
    constructor(
        address admin,
        address forwarder_,
        ISettlementRulings settlement_,
        LotFactory factory_,
        uint64 rulingTimeoutBlocks_
    ) ReceiverBase(admin, forwarder_) {
        if (address(settlement_) == address(0) || address(factory_) == address(0)) {
            revert ZeroAddress();
        }
        if (rulingTimeoutBlocks_ == 0) revert ZeroTimeout();
        settlement = settlement_;
        factory = factory_;
        rulingTimeoutBlocks = rulingTimeoutBlocks_;
    }

    /// @notice Buyer, before handover and before the lot's pickup deadline + report window: escrows the disputed tokens
    ///         and asks W3 for a quality ruling. Settlement checks the window and holds the share of held money back.
    function openDispute(uint256 lotId, uint256 tokenAmount, bytes32 evidenceHash, string calldata evidenceURI)
        external
        nonReentrant
    {
        address token = factory.getLot(lotId).token; // view; reverts for an unknown lot
        _open(lotId, msg.sender, KIND_QUALITY, tokenAmount, evidenceHash, evidenceURI);
        // Settlement (immutable) validates the window and amount and holds the money back; any revert undoes the
        // record above, and its reason reaches the buyer unchanged. Then the tokens move into escrow.
        settlement.onDisputeOpened(lotId, msg.sender, tokenAmount);
        LotToken(token).escrowFrom(msg.sender, tokenAmount);
    }

    /// @notice Settlement, when a seller contests a no-show. The tokens stay escrowed in settlement.
    function openNoShowRuling(
        uint256 lotId,
        address buyer,
        uint256 tokenAmount,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external returns (uint256 disputeId) {
        if (msg.sender != address(settlement)) revert NotSettlement(msg.sender);
        return _open(lotId, buyer, KIND_NO_SHOW, tokenAmount, evidenceHash, evidenceURI);
    }

    /// @notice Anyone, after `rulingTimeoutBlocks` with no ruling: settles with no refund (seller paid, record kept).
    function expireDispute(uint256 disputeId) external nonReentrant {
        Dispute storage d = _disputes[disputeId];
        if (!d.open) revert DisputeNotOpen(disputeId);
        uint64 deadline = d.openedBlock + rulingTimeoutBlocks;
        if (block.number <= deadline) revert TooEarly(deadline);
        d.open = false;
        emit DisputeExpired(disputeId, d.lotId);
        settlement.resolveRuling(d.lotId, d.buyer, d.tokenAmount, 0);
    }

    /// @dev W3 ruling. A report for a dispute that is already resolved or expired is stale and reverts.
    function _processReport(bytes calldata report) internal override nonReentrant {
        (uint256 disputeId, uint16 refundBps, bytes32 reasonHash) = abi.decode(report, (uint256, uint16, bytes32));
        Dispute storage d = _disputes[disputeId];
        if (!d.open) revert DisputeNotOpen(disputeId);
        if (refundBps > BPS) revert BadRefundBps(refundBps);
        d.open = false;
        emit DisputeResolved(disputeId, d.lotId, refundBps, reasonHash);
        settlement.resolveRuling(d.lotId, d.buyer, d.tokenAmount, refundBps);
    }

    function _open(
        uint256 lotId,
        address buyer,
        uint8 kind,
        uint256 tokenAmount,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) internal returns (uint256 disputeId) {
        disputeId = ++disputeCount;
        _disputes[disputeId] = Dispute({
            lotId: lotId,
            buyer: buyer,
            kind: kind,
            open: true,
            // forge-lint: disable-next-line(unsafe-typecast) block numbers fit uint64
            openedBlock: uint64(block.number),
            tokenAmount: tokenAmount
        });
        emit DisputeOpened(disputeId, lotId, buyer, kind, tokenAmount, evidenceHash, evidenceURI);
    }

    function disputeOf(uint256 disputeId) external view returns (Dispute memory) {
        return _disputes[disputeId];
    }
}
// forge-lint: disable-end(reentrancy-no-eth, reentrancy-events)
