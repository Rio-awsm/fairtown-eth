// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    IContinuousClearingAuctionFactory
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuctionFactory.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// S1 0.1: proves the toolchain compiles and links CCA v2.1.0, Permit2 and OpenZeppelin 5.
contract SmokeTest is Test {
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    string internal constant FACTORY_ARTIFACT = "ContinuousClearingAuctionFactory.sol:ContinuousClearingAuctionFactory";

    function _deployFactory(address feeController) internal returns (IContinuousClearingAuctionFactory) {
        return IContinuousClearingAuctionFactory(vm.deployCode(FACTORY_ARTIFACT, abi.encode(feeController)));
    }

    function test_compilerIsPinned() public {
        // A pragma mismatch would fail the build; this asserts the EVM target supports transient storage (Cancun+),
        // which CCA's ReentrancyGuardTransient needs.
        uint256 x;
        assembly {
            tstore(0, 1)
            x := tload(0)
        }
        assertEq(x, 1);
    }

    /// D-04: our own factory with a zero fee controller.
    function test_ccaFactoryDeploysWithZeroFeeController() public {
        IContinuousClearingAuctionFactory factory = _deployFactory(address(0));
        assertGt(address(factory).code.length, 0, "factory has no code");
        assertEq(address(factory.protocolFeeController()), address(0));
    }

    function test_ccaFactoryFitsEip170() public {
        IContinuousClearingAuctionFactory factory = _deployFactory(address(0));
        assertLe(address(factory).code.length, 24_576, "factory runtime over EIP-170");
    }

    function test_RevertWhen_createAmountAboveUint128() public {
        IContinuousClearingAuctionFactory factory = _deployFactory(address(0));
        uint256 tooMuch = uint256(type(uint128).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(IContinuousClearingAuctionFactory.InvalidTokenAmount.selector, tooMuch));
        factory.create(address(1), tooMuch, "", bytes32(0));
    }

    /// Gotcha for NOTES.md: plain anvil / the local EVM has no Permit2. Integration tests must etch or fork it.
    function test_plainEvmHasNoPermit2() public view {
        assertEq(PERMIT2.code.length, 0);
    }

    function test_permit2AndOzLink() public {
        ERC20 token = new SmokeToken();
        assertEq(token.decimals(), 18);
        assertEq(IAllowanceTransfer.approve.selector, bytes4(keccak256("approve(address,address,uint160,uint48)")));
    }
}

contract SmokeToken is ERC20("Smoke", "SMK") {}
