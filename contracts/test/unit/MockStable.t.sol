// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {MockStable} from "../../src/tokens/MockStable.sol";

contract MockStableTest is Test {
    MockStable internal tusd;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_762_400_000);
        tusd = new MockStable("Test USD", "tUSD", admin);
    }

    function test_metadata() public view {
        assertEq(tusd.name(), "Test USD");
        assertEq(tusd.symbol(), "tUSD");
        assertEq(tusd.decimals(), 6);
        assertTrue(tusd.hasRole(tusd.OPERATOR_ROLE(), admin));
    }

    function test_operatorMints() public {
        vm.prank(admin);
        tusd.mint(alice, 7_500_000);
        assertEq(tusd.balanceOf(alice), 7_500_000);
    }

    function test_RevertWhen_nonOperatorMints() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, tusd.OPERATOR_ROLE()
            )
        );
        vm.prank(alice);
        tusd.mint(alice, 1);
    }

    function test_RevertWhen_zeroAdmin() public {
        vm.expectRevert(MockStable.ZeroAddress.selector);
        new MockStable("Test EUR", "tEUR", address(0));
    }

    function test_dripGives5000() public {
        tusd.drip(alice);
        assertEq(tusd.balanceOf(alice), 5_000_000_000);
        assertEq(tusd.nextDripAt(alice), block.timestamp + 24 hours);
    }

    function test_RevertWhen_dripTwiceWithin24h() public {
        tusd.drip(alice);
        uint256 next = vm.getBlockTimestamp() + 24 hours;
        vm.warp(next - 1);
        vm.expectRevert(abi.encodeWithSelector(MockStable.DripTooSoon.selector, alice, next));
        tusd.drip(alice);
    }

    function test_dripAgainAfter24h() public {
        tusd.drip(alice);
        vm.warp(vm.getBlockTimestamp() + 24 hours);
        tusd.drip(alice);
        assertEq(tusd.balanceOf(alice), 10_000_000_000);
    }

    function test_dripCapIsPerRecipient() public {
        tusd.drip(alice);
        tusd.drip(makeAddr("bob"));
        assertEq(tusd.totalSupply(), 10_000_000_000);
    }

    /// Fuzz: however drips are timed, a recipient never gets more than one drip per started 24h window.
    function testFuzz_dripCap(uint32[8] memory gaps) public {
        uint256 t0 = vm.getBlockTimestamp();
        uint256 drips;
        for (uint256 i; i < gaps.length; i++) {
            vm.warp(vm.getBlockTimestamp() + uint256(gaps[i]) % 2 days);
            if (vm.getBlockTimestamp() >= tusd.nextDripAt(alice)) {
                tusd.drip(alice);
                drips++;
            } else {
                vm.expectRevert();
                tusd.drip(alice);
            }
        }
        uint256 maxDrips = (vm.getBlockTimestamp() - t0) / 24 hours + 1;
        assertLe(drips, maxDrips);
        assertEq(tusd.balanceOf(alice), drips * tusd.DRIP_AMOUNT());
    }
}
