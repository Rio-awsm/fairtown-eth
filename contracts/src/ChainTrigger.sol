// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LotFactory} from "./LotFactory.sol";
import {Keys} from "./libraries/Keys.sol";

interface IChainTrigger {
    function onSettled(uint256 lotId) external;
}

interface ISettlementViews {
    function heldOf(uint256 lotId)
        external
        view
        returns (uint256 held, uint256 soldTokens, uint64 pickupDeadline, address carrier);
}

/// @title ChainTrigger
/// @notice A sale opens the next market (contract 7.6): transport for goods that move, storage on request.
contract ChainTrigger is IChainTrigger {
    uint256 internal constant UNIT = 1e18;

    address public immutable settlement;
    LotFactory public immutable factory;

    event TransportNeeded(
        uint256 indexed lotId, bytes32 indexed fromMarket, bytes32 place, uint256 qty, uint64 readyByBlock
    );
    event StorageNeeded(uint256 indexed lotId, address indexed requester, uint256 qty, uint16 days_);

    error ZeroAddress();
    error NotSettlement(address caller);
    error NotAHolder(address requester, uint256 needed, uint256 balance);
    error ZeroQtyOrDays();

    constructor(address settlement_, LotFactory factory_) {
        if (settlement_ == address(0) || address(factory_) == address(0)) revert ZeroAddress();
        settlement = settlement_;
        factory = factory_;
    }

    /// @notice Emits TransportNeeded for produce, fish and flowers when anything sold.
    /// @dev qty = sold tokens in whole units rounded up (D-42), so a truck is never under-booked.
    ///      readyByBlock = the lot's pickup deadline (a truck lot must clear before it).
    function onSettled(uint256 lotId) external {
        if (msg.sender != settlement) revert NotSettlement(msg.sender);
        LotFactory.Lot memory lot = factory.getLot(lotId);
        if (!Keys.needsTransport(lot.spec.sector)) return;
        // View call to the immutable settlement (our only caller); only two of its four values are needed.
        // forge-lint: disable-next-line(unused-return)
        (, uint256 soldTokens, uint64 pickupDeadline,) = ISettlementViews(settlement).heldOf(lotId);
        if (soldTokens == 0) return;
        // forge-lint: disable-next-item(reentrancy-events) the calls above are views on immutable contracts
        emit TransportNeeded(lotId, lot.spec.market, lot.spec.place, Math.ceilDiv(soldTokens, UNIT), pickupDeadline);
    }

    /// @notice A holder of a lot's tokens asks for cold storage for `qty` whole units.
    function requestStorage(uint256 lotId, uint256 qty, uint16 days_) external {
        if (qty == 0 || days_ == 0) revert ZeroQtyOrDays();
        LotFactory.Lot memory lot = factory.getLot(lotId);
        uint256 bal = IERC20(lot.token).balanceOf(msg.sender);
        if (bal < qty * UNIT) revert NotAHolder(msg.sender, qty * UNIT, bal);
        emit StorageNeeded(lotId, msg.sender, qty, days_);
    }
}
