// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LotToken} from "../../src/tokens/LotToken.sol";

contract LotTokenTest is Test {
    LotToken internal token;
    address internal factory = makeAddr("factory");
    address internal settlement = makeAddr("settlement");
    address internal resolver = makeAddr("resolver");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");
    uint256 internal constant SUPPLY = 600e18; // 600 kg cod

    function setUp() public {
        token = new LotToken("Lot 12 Cod", "LOT12", SUPPLY, factory, settlement, resolver);
        vm.prank(factory);
        token.transfer(buyer, 100e18);
    }

    function test_metadataAndSupply() public view {
        assertEq(token.name(), "Lot 12 Cod");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(factory), SUPPLY - 100e18);
        assertEq(token.settlement(), settlement);
        assertEq(token.resolver(), resolver);
    }

    function test_settlementBurnsWithoutApproval() public {
        vm.prank(settlement);
        token.burnFrom(buyer, 40e18);
        assertEq(token.balanceOf(buyer), 60e18);
        assertEq(token.totalSupply(), SUPPLY - 40e18);
    }

    function test_RevertWhen_resolverOrStrangerBurns() public {
        vm.expectRevert(abi.encodeWithSelector(LotToken.NotSettlement.selector, resolver));
        vm.prank(resolver);
        token.burnFrom(buyer, 1);
        vm.expectRevert(abi.encodeWithSelector(LotToken.NotSettlement.selector, buyer));
        vm.prank(buyer);
        token.burnFrom(buyer, 1);
    }

    function test_settlementAndResolverEscrow() public {
        vm.prank(settlement);
        token.escrowFrom(buyer, 30e18);
        vm.prank(resolver);
        token.escrowFrom(buyer, 20e18);
        assertEq(token.balanceOf(settlement), 30e18);
        assertEq(token.balanceOf(resolver), 20e18);
        assertEq(token.balanceOf(buyer), 50e18);
    }

    function test_RevertWhen_strangerEscrows() public {
        vm.expectRevert(abi.encodeWithSelector(LotToken.NotSettlementOrResolver.selector, stranger));
        vm.prank(stranger);
        token.escrowFrom(buyer, 1);
    }

    function test_RevertWhen_escrowMoreThanBalance() public {
        vm.expectRevert();
        vm.prank(settlement);
        token.escrowFrom(buyer, 100e18 + 1);
    }

    /// With no resolver yet (v1 deploy), address(0) must not become a privileged caller.
    function test_zeroResolverGrantsNothing() public {
        LotToken t = new LotToken("Lot 1 Cod", "LOT1", SUPPLY, factory, settlement, address(0));
        vm.expectRevert(abi.encodeWithSelector(LotToken.NotSettlementOrResolver.selector, address(0)));
        vm.prank(address(0));
        t.escrowFrom(factory, 1);
    }

    function test_RevertWhen_zeroSettlementOrMintTo() public {
        vm.expectRevert(LotToken.ZeroAddress.selector);
        new LotToken("x", "x", 1, factory, address(0), resolver);
        vm.expectRevert(LotToken.ZeroAddress.selector);
        new LotToken("x", "x", 1, address(0), settlement, resolver);
    }

    /// Only settlement can burn, for any caller and amount.
    function testFuzz_onlySettlementBurns(address caller, uint256 amount) public {
        vm.assume(caller != settlement);
        amount = bound(amount, 1, 100e18);
        vm.expectRevert(abi.encodeWithSelector(LotToken.NotSettlement.selector, caller));
        vm.prank(caller);
        token.burnFrom(buyer, amount);
    }
}
