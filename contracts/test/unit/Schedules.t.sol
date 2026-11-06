// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Schedules} from "../../src/libraries/Schedules.sol";

contract SchedulesHarness {
    function endWeighted(uint256 d, uint256 s) external pure returns (bytes memory) {
        return Schedules.endWeighted(d, s);
    }

    /// Builds and decodes in one external call so its memory is released per call (keeps sweeps O(1) memory).
    /// Decodes like CCA StepLib.parse: each 8 bytes = uint24 mps | uint40 blockDelta.
    function summarize(uint256 d, uint256 s)
        external
        pure
        returns (uint256 mpsSum, uint256 blocks, uint256 lastMps, uint256 minDelta)
    {
        bytes memory data = Schedules.endWeighted(d, s);
        require(data.length % 8 == 0, "length");
        minDelta = type(uint256).max;
        for (uint256 i; i < data.length; i += 8) {
            uint64 word;
            assembly {
                word := shr(192, mload(add(add(data, 0x20), i)))
            }
            uint256 mps = uint24(word >> 40);
            uint256 delta = uint40(word);
            if (delta < minDelta) minDelta = delta;
            mpsSum += mps * delta;
            blocks += delta;
            lastMps = mps;
        }
    }
}

contract SchedulesTest is Test {
    SchedulesHarness internal h = new SchedulesHarness();

    function _check(uint256 d, uint256 s) internal view {
        (uint256 sum, uint256 blocks, uint256 lastMps, uint256 minDelta) = h.summarize(d, s);
        assertGt(minDelta, 0, "zero blockDelta is rejected by CCA");
        assertEq(sum, 1e7, "mps sum");
        assertEq(blocks, d, "block span");
        // Last block gets at least its share (plus the rounding remainder).
        assertGe(lastMps, 1e7 * s / 1e4);
    }

    /// Guide: durations 2 to 500 and shares 0 to 9000. Every duration, shares on a 100 bps grid.
    function test_sumsExactlyForAllDurations() public view {
        for (uint256 d = 2; d <= 500; d++) {
            for (uint256 s = 0; s <= 9000; s += 100) {
                _check(d, s);
            }
        }
    }

    /// Every share 0..9000 at a few durations.
    function test_sumsExactlyForAllShares() public view {
        uint256[4] memory ds = [uint256(2), 45, 333, 500];
        for (uint256 k; k < ds.length; k++) {
            for (uint256 s = 0; s <= 9000; s++) {
                _check(ds[k], s);
            }
        }
    }

    function testFuzz_sumsExactly(uint256 d, uint256 s) public view {
        _check(bound(d, 2, 100_000), bound(s, 0, 10_000));
    }

    function test_example45BlocksHalfOnLast() public view {
        bytes memory data = h.endWeighted(45, 5000);
        // early = (1e7 * 5000 / 1e4) / 44 = 113636; last = 1e7 - 113636 * 44 = 5000016
        assertEq(data, abi.encodePacked(uint24(113_636), uint40(44), uint24(5_000_016), uint40(1)));
    }

    function test_RevertWhen_badInputs() public {
        vm.expectRevert(abi.encodeWithSelector(Schedules.DurationTooShort.selector, 1));
        h.endWeighted(1, 5000);
        vm.expectRevert(abi.encodeWithSelector(Schedules.DurationTooShort.selector, 0));
        h.endWeighted(0, 5000);
        vm.expectRevert(abi.encodeWithSelector(Schedules.ShareTooHigh.selector, 10_001));
        h.endWeighted(45, 10_001);
        uint256 tooLong = uint256(type(uint40).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(Schedules.DurationTooLong.selector, tooLong));
        h.endWeighted(tooLong, 5000);
    }
}
