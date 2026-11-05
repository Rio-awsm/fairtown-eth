// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {IDistributorFactory} from "liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {IAgentRegistry} from "./registry/AgentRegistry.sol";
import {LotToken} from "./tokens/LotToken.sol";
import {PriceMath} from "./libraries/PriceMath.sol";
import {Keys} from "./libraries/Keys.sol";
import {Schedules} from "./libraries/Schedules.sol";

/// @title LotFactory
/// @notice One call turns a lot into a funded Uniswap CCA (v2.1.0) auction in an allowed currency.
///         Contract section 7.4. Settlement is both recipients of every auction.
contract LotFactory is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Contract 5: product minimum price, 0.001 per unit.
    uint256 public constant MIN_FLOOR_PER_UNIT = 1000;
    uint256 internal constant UNIT = 1e18;

    struct LotSpec {
        bytes32 sector;
        bytes32 market;
        bytes32 commodity;
        bytes32 grade;
        bytes32 place;
        address currency;
        uint256 qty;
        uint256 floorPerUnit;
        uint64 durationBlocks;
        uint64 pickupWindowBlocks;
        uint256 parentLotId;
        address seller;
        string metadataURI;
    }

    struct Lot {
        LotSpec spec;
        address auction;
        address token;
        uint64 startBlock;
        uint64 endBlock;
        uint256 floorQ96;
        uint256 tickSpacingQ96;
        uint8 status; // 0 OPEN, 1 SETTLED, 2 RELISTED, 3 CLOSED
    }

    IDistributorFactory public immutable ccaFactory;
    IAgentRegistry public immutable registry;
    address public immutable hook;
    address public immutable settlement;
    address public immutable resolver;
    uint256 public immutable lastBlockShareBps;

    mapping(address currency => bool) internal _currencies;
    mapping(uint256 lotId => Lot) internal _lots;
    uint256 public lotCount;

    event LotListed(
        uint256 indexed lotId,
        address indexed seller,
        bytes32 indexed market,
        address auction,
        address token,
        address currency,
        bytes32 sector,
        bytes32 commodity,
        bytes32 place,
        uint256 qty,
        uint256 floorPerUnit,
        uint64 startBlock,
        uint64 endBlock,
        uint256 parentLotId,
        string metadataURI
    );
    event CurrencySet(address indexed currency, bool allowed);

    error ZeroAddress();
    error NotAuthorized(address caller);
    error SellerCannotList(address seller);
    error NotSettlement(address caller);
    error CurrencyNotAllowed(address currency);
    error ZeroQty();
    error QtyTooLarge(uint256 qty);
    error DurationTooShort(uint64 durationBlocks);
    error ZeroPickupWindow();
    error UnknownSector(bytes32 sector);
    error FloorTooLow(uint256 floorPerUnit);
    error UnknownParent(uint256 parentLotId);
    error UnknownLot(uint256 lotId);

    /// @param settlement_ MarketSettlement, predicted by the deploy script (D-41) so both sides are immutable.
    /// @param resolver_ DisputeResolver, or address(0) before S1 4.1.
    constructor(
        address admin,
        IDistributorFactory ccaFactory_,
        IAgentRegistry registry_,
        address hook_,
        address settlement_,
        // forge-lint: disable-next-line(missing-zero-check) zero is valid until DisputeResolver exists (S1 4.1)
        address resolver_,
        uint256 lastBlockShareBps_
    ) {
        if (
            admin == address(0) || address(ccaFactory_) == address(0) || address(registry_) == address(0)
                || hook_ == address(0) || settlement_ == address(0)
        ) revert ZeroAddress();
        // Validates the share once, with the same rules every lot will use.
        Schedules.endWeighted(2, lastBlockShareBps_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        ccaFactory = ccaFactory_;
        registry = registry_;
        hook = hook_;
        settlement = settlement_;
        resolver = resolver_;
        lastBlockShareBps = lastBlockShareBps_;
    }

    // ------------------------------------------------------------------ admin

    function setCurrency(address currency, bool allowed) external onlyRole(OPERATOR_ROLE) {
        if (currency == address(0)) revert ZeroAddress(); // ERC-20 only: bids pull through Permit2
        _currencies[currency] = allowed;
        emit CurrencySet(currency, allowed);
    }

    // ------------------------------------------------------------------ listing

    /// @notice Caller is the seller (who can list) or an operator listing for a seller who can list.
    function createLot(LotSpec calldata spec) external returns (uint256 lotId, address auction, address token) {
        if (msg.sender != spec.seller && !hasRole(OPERATOR_ROLE, msg.sender)) revert NotAuthorized(msg.sender);
        if (!registry.canList(spec.seller)) revert SellerCannotList(spec.seller);
        if (spec.parentLotId != 0 && spec.parentLotId > lotCount) revert UnknownParent(spec.parentLotId);
        return _create(spec);
    }

    /// @notice Settlement relists unsold supply as a new lot with a new token (contract 7.5 `relist`).
    function createRelistedLot(LotSpec calldata spec) external returns (uint256 lotId, address auction, address token) {
        if (msg.sender != settlement) revert NotSettlement(msg.sender);
        if (spec.parentLotId == 0 || spec.parentLotId > lotCount) revert UnknownParent(spec.parentLotId);
        return _create(spec);
    }

    function _create(LotSpec calldata spec) internal returns (uint256 lotId, address auction, address token) {
        _validate(spec);
        lotId = ++lotCount;

        uint256 supply = spec.qty * UNIT;
        token = address(
            new LotToken(
                string.concat("Lot ", Strings.toString(lotId), " ", _label(spec.commodity)),
                string.concat("LOT", Strings.toString(lotId)),
                supply,
                address(this),
                settlement,
                resolver
            )
        );

        uint256 tick = PriceMath.tickFor(PriceMath.toQ96(spec.floorPerUnit));
        uint256 floorQ96 = PriceMath.floorToTick(PriceMath.toQ96(spec.floorPerUnit), tick);
        // forge-lint: disable-next-line(unsafe-typecast) block numbers fit uint64 for billions of years
        uint64 startBlock = uint64(block.number + 1);
        uint64 endBlock = startBlock + spec.durationBlocks;

        AuctionParameters memory p = AuctionParameters({
            currency: spec.currency,
            tokensRecipient: settlement,
            fundsRecipient: settlement,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock,
            tickSpacing: tick,
            validationHook: hook,
            floorPrice: floorQ96,
            requiredCurrencyRaised: 0,
            auctionStepsData: Schedules.endWeighted(spec.durationBlocks, lastBlockShareBps)
        });
        auction = address(ccaFactory.create(token, supply, abi.encode(p), bytes32(lotId)));
        // Fund and activate in the same transaction, so no bid can ever reach an unfunded auction.
        IERC20(token).safeTransfer(auction, supply);
        IContinuousClearingAuction(auction).onTokensReceived();

        Lot storage l = _lots[lotId];
        l.spec = spec;
        l.auction = auction;
        l.token = token;
        l.startBlock = startBlock;
        l.endBlock = endBlock;
        l.floorQ96 = floorQ96;
        l.tickSpacingQ96 = tick;
        _emitListed(lotId, l);
    }

    function _validate(LotSpec calldata spec) internal view {
        if (spec.seller == address(0)) revert ZeroAddress();
        if (!_currencies[spec.currency]) revert CurrencyNotAllowed(spec.currency);
        if (spec.qty == 0) revert ZeroQty();
        // CCA factory takes uint128 token amounts.
        if (spec.qty > type(uint128).max / UNIT) revert QtyTooLarge(spec.qty);
        if (spec.durationBlocks < 2) revert DurationTooShort(spec.durationBlocks);
        if (spec.pickupWindowBlocks == 0) revert ZeroPickupWindow(); // every lot state has a timeout
        if (!Keys.isSector(spec.sector)) revert UnknownSector(spec.sector);
        if (spec.floorPerUnit < MIN_FLOOR_PER_UNIT) revert FloorTooLow(spec.floorPerUnit);
    }

    function _emitListed(uint256 lotId, Lot storage l) internal {
        LotSpec storage s = l.spec;
        // The only external calls before this go to the immutable CCA factory and to the auction and token created
        // in this same call; none can call back in. lotCount was bumped first, so ids cannot be reused.
        // forge-lint: disable-next-item(reentrancy-events)
        emit LotListed(
            lotId,
            s.seller,
            s.market,
            l.auction,
            l.token,
            s.currency,
            s.sector,
            s.commodity,
            s.place,
            s.qty,
            s.floorPerUnit,
            l.startBlock,
            l.endBlock,
            s.parentLotId,
            s.metadataURI
        );
    }

    /// @notice "cod" -> "Cod", "truck_capacity" -> "Truck capacity".
    function _label(bytes32 key) internal pure returns (string memory) {
        uint256 n = 0;
        while (n < 32 && key[n] != 0) n++;
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; i++) {
            bytes1 c = key[i];
            if (c == "_") c = " ";
            else if (i == 0 && c >= "a" && c <= "z") c = bytes1(uint8(c) - 32);
            out[i] = c;
        }
        return string(out);
    }

    // ------------------------------------------------------------------ views

    function isCurrency(address currency) external view returns (bool) {
        return _currencies[currency];
    }

    function getLot(uint256 lotId) external view returns (Lot memory) {
        if (lotId == 0 || lotId > lotCount) revert UnknownLot(lotId);
        return _lots[lotId];
    }
}
