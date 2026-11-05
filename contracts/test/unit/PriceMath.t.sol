// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PriceMath} from "../../src/libraries/PriceMath.sol";

contract PriceMathHarness {
    function floorToTick(uint256 q, uint256 t) external pure returns (uint256) {
        return PriceMath.floorToTick(q, t);
    }

    function ceilToTick(uint256 q, uint256 t) external pure returns (uint256) {
        return PriceMath.ceilToTick(q, t);
    }

    function splitPayout(uint256 r, uint256 f, uint256 a) external pure returns (uint256, uint256, uint256) {
        return PriceMath.splitPayout(r, f, a);
    }
}

contract PriceMathTest is Test {
    PriceMathHarness internal h = new PriceMathHarness();
    uint256 internal constant Q96 = 2 ** 96;

    function test_constants() public pure {
        assertEq(PriceMath.Q96, 79_228_162_514_264_337_593_543_950_336);
        assertEq(PriceMath.UNIT, 1e18);
    }

    /// Contract 5: one base unit per unit gives 79228162514, above CCA's minimum floor 2^32 + 1.
    function test_minimumFloorNote() public pure {
        assertEq(PriceMath.toQ96(1), 79_228_162_514);
        assertGt(PriceMath.toQ96(1), 2 ** 32 + 1);
    }

    /// Guide 1.3 example: EUR 5,460 raised, 1% fee, new seller 50%: 54.60 fee, 2,702.70 advance, 2,702.70 held.
    function test_splitPayoutGuideExample() public pure {
        (uint256 fee, uint256 adv, uint256 held) = PriceMath.splitPayout(5_460_000_000, 100, 5000);
        assertEq(fee, 54_600_000);
        assertEq(adv, 2_702_700_000);
        assertEq(held, 2_702_700_000);
    }

    function testFuzz_splitPayoutInvariant(uint256 raised, uint256 feeBps, uint256 advBps) public pure {
        raised = bound(raised, 0, type(uint128).max);
        feeBps = bound(feeBps, 0, 10_000);
        advBps = bound(advBps, 0, 10_000);
        (uint256 fee, uint256 adv, uint256 held) = PriceMath.splitPayout(raised, feeBps, advBps);
        assertEq(fee + adv + held, raised);
        assertEq(fee, raised * feeBps / 10_000);
    }

    function testFuzz_q96RoundTripNeverOverstates(uint256 perUnit) public pure {
        perUnit = bound(perUnit, 1000, 1e30);
        uint256 back = PriceMath.fromQ96(PriceMath.toQ96(perUnit));
        assertLe(back, perUnit);
        assertGe(back + 1, perUnit); // loses at most one base unit
    }

    function testFuzz_ticks(uint256 perUnit, uint256 bump) public pure {
        perUnit = bound(perUnit, 1000, 1e24);
        uint256 q = PriceMath.toQ96(perUnit);
        uint256 tick = PriceMath.tickFor(q);
        assertGe(tick, 2);
        uint256 floorQ = PriceMath.floorToTick(q, tick);
        assertEq(floorQ % tick, 0);
        assertLe(floorQ, q);
        assertGt(floorQ + tick, q);
        assertGt(floorQ, 2 ** 32 + 1, "CCA minimum floor");
        uint256 bid = q + bound(bump, 0, 1e30);
        uint256 c = PriceMath.ceilToTick(bid, tick);
        assertEq(c % tick, 0);
        assertGe(c, bid);
        assertLt(c - bid, tick);
    }

    function test_tickNeverBelow2() public pure {
        assertEq(PriceMath.tickFor(0), 2);
        assertEq(PriceMath.tickFor(299), 2);
        assertEq(PriceMath.tickFor(300), 3);
    }

    function test_RevertWhen_zeroTickOrBpsTooHigh() public {
        vm.expectRevert(PriceMath.ZeroTick.selector);
        h.floorToTick(1, 0);
        vm.expectRevert(PriceMath.ZeroTick.selector);
        h.ceilToTick(1, 0);
        vm.expectRevert(abi.encodeWithSelector(PriceMath.BpsTooHigh.selector, 10_001));
        h.splitPayout(1, 10_001, 0);
        vm.expectRevert(abi.encodeWithSelector(PriceMath.BpsTooHigh.selector, 10_001));
        h.splitPayout(1, 0, 10_001);
    }

    // ---------------------------------------------------------------- vectors for @fairtown/shared

    string internal constant VECTORS = "/../packages/shared/fixtures/price-vectors.json";

    /// Writes 20 vectors; packages/shared/test/price-vectors.test.ts recomputes them with units.ts.
    function test_exportPriceVectors() public {
        uint256[20] memory perUnit = [
            uint256(1000), // product minimum 0.001
            1_000_000, // 1.00
            7_500_000, // cod floor EUR 7.50
            7_650_000, // relist 7.65
            9_000_000, // 9.00
            2_490_000,
            12_345_678,
            55_000_000,
            199_990_000,
            1, // one base unit
            3,
            333_333,
            1_234_567_890,
            42_000_000_000,
            987_654_321_012,
            10 ** 18,
            10 ** 21,
            2 ** 64,
            2 ** 100,
            123_456_789_012_345_678_901
        ];
        uint256[20] memory raised = [
            uint256(0),
            5_460_000_000,
            1,
            99,
            100,
            10_001,
            1_234_567,
            4_500_000_000,
            7_777_777_777,
            type(uint64).max,
            3,
            999_999,
            10 ** 12,
            31_415_926_535,
            2 ** 80,
            type(uint128).max,
            42,
            1_000_000,
            2_702_700_000,
            123_456_789
        ];
        uint256[3] memory adv = [uint256(5000), 9000, 1000]; // D-09: new, proven, truck
        string memory root = "vectors";
        string memory out;
        for (uint256 i; i < 20; i++) {
            string memory k = string.concat("v", vm.toString(i));
            out = vm.serializeString(root, k, _vector(k, perUnit[i], raised[i], adv[i % 3]));
        }
        vm.writeJson(out, string.concat(vm.projectRoot(), VECTORS));
        // Read back: 20 entries, the guide example (v1) intact.
        string memory json = vm.readFile(string.concat(vm.projectRoot(), VECTORS));
        assertEq(vm.parseJsonKeys(json, "$").length, 20);
        assertEq(vm.parseJsonString(json, ".v1.fee"), "54600000");
    }

    function _vector(string memory k, uint256 perUnit, uint256 raised, uint256 advBps)
        internal
        returns (string memory)
    {
        uint256 q = PriceMath.toQ96(perUnit);
        uint256 tick = PriceMath.tickFor(q);
        uint256 bidIn = q + q / 7 + 1;
        vm.serializeString(k, "perUnit", vm.toString(perUnit));
        vm.serializeString(k, "q96", vm.toString(q));
        vm.serializeString(k, "fromQ96", vm.toString(PriceMath.fromQ96(q)));
        vm.serializeString(k, "tick", vm.toString(tick));
        vm.serializeString(k, "floorQ96", vm.toString(PriceMath.floorToTick(q, tick)));
        vm.serializeString(k, "bidInQ96", vm.toString(bidIn));
        vm.serializeString(k, "bidQ96", vm.toString(PriceMath.ceilToTick(bidIn, tick)));
        (uint256 fee, uint256 a, uint256 held) = PriceMath.splitPayout(raised, 100, advBps);
        vm.serializeString(k, "raised", vm.toString(raised));
        vm.serializeString(k, "feeBps", "100");
        vm.serializeString(k, "advanceBps", vm.toString(advBps));
        vm.serializeString(k, "fee", vm.toString(fee));
        vm.serializeString(k, "advance", vm.toString(a));
        return vm.serializeString(k, "held", vm.toString(held));
    }
}
