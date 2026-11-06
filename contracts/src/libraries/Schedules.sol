// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Schedules
/// @notice CCA `auctionStepsData` builders. Each step is `abi.encodePacked(uint24 mps, uint40 blockDelta)`;
///         CCA requires sum(mps * blockDelta) == 1e7 and sum(blockDelta) == endBlock - startBlock
///         (StepStorage._validate, CCA v2.1.0). A zero blockDelta is rejected; a zero mps is allowed.
library Schedules {
    uint256 internal constant MPS = 1e7;
    uint256 internal constant BPS = 10_000;

    error DurationTooShort(uint256 duration);
    error DurationTooLong(uint256 duration);
    error ShareTooHigh(uint256 shareBps);

    /// @notice Two steps: blocks 1..duration-1 sell an equal share, the last block sells `lastBlockShareBps`
    ///         of supply plus the rounding remainder, so the sum is exactly 1e7.
    /// @dev early = (1e7 * (1e4 - share) / 1e4) / (duration - 1); last = 1e7 - early * (duration - 1).
    function endWeighted(uint256 duration, uint256 lastBlockShareBps) internal pure returns (bytes memory) {
        if (duration < 2) revert DurationTooShort(duration);
        if (duration > type(uint40).max) revert DurationTooLong(duration);
        if (lastBlockShareBps > BPS) revert ShareTooHigh(lastBlockShareBps);
        // forge-lint: disable-next-line(divide-before-multiply) the guide's formula; the remainder goes to the last step
        uint256 early = (MPS * (BPS - lastBlockShareBps) / BPS) / (duration - 1);
        // forge-lint: disable-next-line(divide-before-multiply) uses the floored `early` on purpose
        uint256 last = MPS - early * (duration - 1);
        // early, last <= 1e7 < 2^24 and duration was checked against uint40 above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return abi.encodePacked(uint24(early), uint40(duration - 1), uint24(last), uint40(1));
    }
}
