// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IValidationHook} from "continuous-clearing-auction/interfaces/IValidationHook.sol";
import {AgentRegistry, IAgentRegistry} from "../../src/registry/AgentRegistry.sol";
import {AgentRegistryHook} from "../../src/registry/AgentRegistryHook.sol";

contract AgentRegistryHookTest is Test {
    AgentRegistry internal reg;
    AgentRegistryHook internal hook;
    address internal op = makeAddr("operator");
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");

    function setUp() public {
        reg = new AgentRegistry(op);
        hook = new AgentRegistryHook(IAgentRegistry(address(reg)));
        vm.startPrank(op);
        reg.register(buyer, 2, "buyer");
        reg.register(seller, 1, "seller");
        vm.stopPrank();
    }

    function test_erc165() public view {
        assertEq(type(IValidationHook).interfaceId, bytes4(0x22c44b5f), "contract 7.3 id");
        assertTrue(hook.supportsInterface(0x22c44b5f));
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
        assertFalse(hook.supportsInterface(0xffffffff));
    }

    function test_acceptsRegisteredBidderAsOwnSender() public view {
        hook.validate(1, 1, buyer, buyer, "");
    }

    function test_RevertWhen_senderIsNotOwner() public {
        address router = makeAddr("router");
        vm.expectRevert(abi.encodeWithSelector(AgentRegistryHook.SenderNotOwner.selector, router, buyer));
        hook.validate(1, 1, buyer, router, "");
    }

    function test_RevertWhen_ownerCannotBid() public {
        vm.expectRevert(abi.encodeWithSelector(AgentRegistryHook.NotABidder.selector, seller));
        hook.validate(1, 1, seller, seller, "");
        address nobody = makeAddr("nobody");
        vm.expectRevert(abi.encodeWithSelector(AgentRegistryHook.NotABidder.selector, nobody));
        hook.validate(1, 1, nobody, nobody, "");
    }

    function test_RevertWhen_bidderRevoked() public {
        vm.prank(op);
        reg.setRole(buyer, 0);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistryHook.NotABidder.selector, buyer));
        hook.validate(1, 1, buyer, buyer, "");
    }

    function test_RevertWhen_zeroRegistry() public {
        vm.expectRevert(AgentRegistryHook.ZeroAddress.selector);
        new AgentRegistryHook(IAgentRegistry(address(0)));
    }

    /// Any sender other than the owner is rejected, whatever the bid.
    function testFuzz_onlyOwnerAsSender(address sender, uint256 price, uint128 amount) public {
        vm.assume(sender != buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistryHook.SenderNotOwner.selector, sender, buyer));
        hook.validate(price, amount, buyer, sender, "");
    }
}
