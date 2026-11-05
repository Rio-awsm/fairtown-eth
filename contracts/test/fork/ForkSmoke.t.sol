// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    IContinuousClearingAuctionFactory
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuctionFactory.sol";

interface IPermit2Domain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// S1 0.1: Base Sepolia fork access. Needs RPC_URL in the environment (repo .env); skips cleanly without it.
contract ForkSmokeTest is Test {
    uint256 internal constant BASE_SEPOLIA = 84_532;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function setUp() public {
        if (bytes(vm.envOr("RPC_URL", string(""))).length == 0) {
            vm.skip(true, "RPC_URL unset");
            return;
        }
        vm.createSelectFork("base_sepolia");
    }

    function test_fork_chainIdIsBaseSepolia() public view {
        assertEq(block.chainid, BASE_SEPOLIA);
        assertGt(block.number, 0);
    }

    function test_fork_permit2IsCanonical() public view {
        assertGt(PERMIT2.code.length, 0, "no Permit2 on fork");
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                BASE_SEPOLIA,
                PERMIT2
            )
        );
        assertEq(IPermit2Domain(PERMIT2).DOMAIN_SEPARATOR(), expected);
    }

    /// No CCA factory exists on Base Sepolia for us, so LotFactory deploys its own (D-04). Prove it deploys on the fork.
    function test_fork_ccaFactoryDeploys() public {
        address f = vm.deployCode(
            "ContinuousClearingAuctionFactory.sol:ContinuousClearingAuctionFactory", abi.encode(address(0))
        );
        assertEq(address(IContinuousClearingAuctionFactory(f).protocolFeeController()), address(0));
    }

    function test_RevertWhen_forkingUnknownAlias() public {
        vm.expectRevert();
        this.forkAlias("no_such_chain");
    }

    function forkAlias(string calldata name) external {
        vm.createSelectFork(name);
    }
}
