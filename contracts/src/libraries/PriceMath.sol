// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceMath
/// @notice Mirrors contract section 5 and `@fairtown/shared/units` exactly (all floor division, like TS bigint).
///         Money is currency base units (6 decimals); lot tokens are 18 decimals; CCA prices are Q96.
library PriceMath {
    uint256 internal constant Q96 = 2 ** 96;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant BPS = 10_000;

    error ZeroTick();
    error BpsTooHigh(uint256 bps);

    /// @notice Base units per whole unit -> Q96 price per token wei: perUnit * 2^96 / 1e18.
    function toQ96(uint256 perUnit) internal pure returns (uint256) {
        return Math.mulDiv(perUnit, Q96, UNIT);
    }

    function fromQ96(uint256 q) internal pure returns (uint256) {
        return Math.mulDiv(q, UNIT, Q96);
    }

    /// @notice About 1% of the floor, never below CCA's minimum tick of 2.
    function tickFor(uint256 floorQ96) internal pure returns (uint256) {
        uint256 t = floorQ96 / 100;
        return t > 2 ? t : 2;
    }

    function floorToTick(uint256 q, uint256 tick) internal pure returns (uint256) {
        if (tick == 0) revert ZeroTick();
        // forge-lint: disable-next-line(divide-before-multiply) rounding down to a tick is the intent
        return (q / tick) * tick;
    }

    function ceilToTick(uint256 q, uint256 tick) internal pure returns (uint256) {
        if (tick == 0) revert ZeroTick();
        return Math.ceilDiv(q, tick) * tick;
    }

    /// @notice fee = raised*feeBps/1e4; advance = net*advanceBps/1e4; held = net - advance.
    /// @dev Always fee + advance + held == raised.
    function splitPayout(uint256 raised, uint256 feeBps, uint256 advanceBps)
        internal
        pure
        returns (uint256 fee, uint256 advance, uint256 held)
    {
        if (feeBps > BPS) revert BpsTooHigh(feeBps);
        if (advanceBps > BPS) revert BpsTooHigh(advanceBps);
        fee = Math.mulDiv(raised, feeBps, BPS);
        uint256 net = raised - fee;
        advance = Math.mulDiv(net, advanceBps, BPS);
        held = net - advance;
    }
}
