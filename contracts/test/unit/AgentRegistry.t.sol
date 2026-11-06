// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AgentRegistry} from "../../src/registry/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry internal reg;
    address internal op = makeAddr("operator");
    address internal agent = makeAddr("agent");

    event AgentRegistered(address indexed agent, uint8 role, string name);

    function setUp() public {
        reg = new AgentRegistry(op);
    }

    function test_rolesMatchSharedKeys() public view {
        // @fairtown/shared/keys ROLES = { NONE: 0, SELLER: 1, BUYER: 2, TRUCK: 3, STORAGE: 4, SOCIETY: 5, HUMAN: 6 }
        assertEq(reg.NONE(), 0);
        assertEq(reg.SELLER(), 1);
        assertEq(reg.BUYER(), 2);
        assertEq(reg.TRUCK(), 3);
        assertEq(reg.STORAGE(), 4);
        assertEq(reg.SOCIETY(), 5);
        assertEq(reg.HUMAN(), 6);
    }

    function test_registerEmitsAndStores() public {
        vm.expectEmit(true, false, false, true, address(reg));
        emit AgentRegistered(agent, 2, "kofi.buyer");
        vm.prank(op);
        reg.register(agent, 2, "kofi.buyer");
        assertEq(reg.roleOf(agent), 2);
        assertEq(reg.nameOf(agent), "kofi.buyer");
    }

    /// Role matrix: canBid = BUYER, SOCIETY, HUMAN; canList = SELLER, TRUCK, STORAGE.
    function testFuzz_roleMatrix(uint8 role) public {
        role = uint8(bound(role, 1, 6));
        vm.prank(op);
        reg.register(agent, role, "a");
        bool bid = role == 2 || role == 5 || role == 6;
        bool list = role == 1 || role == 3 || role == 4;
        assertEq(reg.canBid(agent), bid);
        assertEq(reg.canList(agent), list);
        assertTrue(!(bid && list), "no role both bids and lists");
    }

    function test_unregisteredCanDoNothing() public view {
        assertEq(reg.roleOf(agent), 0);
        assertFalse(reg.canBid(agent));
        assertFalse(reg.canList(agent));
    }

    function test_setRoleChangesAndRevokes() public {
        vm.startPrank(op);
        reg.register(agent, 1, "ingrid.seller");
        vm.expectEmit(true, false, false, true, address(reg));
        emit AgentRegistered(agent, 2, "ingrid.seller");
        reg.setRole(agent, 2);
        assertTrue(reg.canBid(agent));
        reg.setRole(agent, 0);
        vm.stopPrank();
        assertFalse(reg.canBid(agent));
        assertFalse(reg.canList(agent));
    }

    function test_RevertWhen_nonOperator() public {
        bytes memory err = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, agent, reg.OPERATOR_ROLE()
        );
        vm.startPrank(agent);
        vm.expectRevert(err);
        reg.register(agent, 2, "self");
        vm.expectRevert(err);
        reg.setRole(agent, 2);
        vm.stopPrank();
    }

    function test_RevertWhen_badRoleOrAddress() public {
        vm.startPrank(op);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.InvalidRole.selector, 0));
        reg.register(agent, 0, "none");
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.InvalidRole.selector, 7));
        reg.register(agent, 7, "seven");
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        reg.register(address(0), 2, "zero");
        reg.register(agent, 2, "ok");
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.AlreadyRegistered.selector, agent));
        reg.register(agent, 1, "again");
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.InvalidRole.selector, 9));
        reg.setRole(agent, 9);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotRegistered.selector, makeAddr("ghost")));
        reg.setRole(makeAddr("ghost"), 2);
        vm.stopPrank();
    }
}
