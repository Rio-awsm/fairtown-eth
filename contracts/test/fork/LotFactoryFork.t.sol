// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {LotFixture, IERC20Like} from "../utils/LotFixture.sol";

/// S1 1.2 fork run: the whole lot flow on a Base Sepolia fork with the real canonical Permit2 (no etch).
contract LotFactoryForkTest is LotFixture {
    function setUp() public {
        if (bytes(vm.envOr("RPC_URL", string(""))).length == 0) {
            vm.skip(true, "RPC_URL unset");
            return;
        }
        vm.createSelectFork("base_sepolia");
        _deploy(DEFAULT_SHARE_BPS);
    }

    /// The etched local copy (test/fixtures/permit2.runtime.hex) is byte-identical to Base Sepolia's Permit2.
    function test_fork_permit2FixtureIsCanonical() public view {
        string memory hexCode = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/permit2.runtime.hex"));
        assertEq(keccak256(PERMIT2.code), keccak256(vm.parseBytes(vm.trim(hexCode))));
    }

    function test_fork_codLotThroughPermit2() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        Placed[] memory bids = new Placed[](2);
        vm.roll(a.startBlock());
        bids[0] = _bid(a, buyerA, 8_000_000, 2000e6);
        vm.roll(a.startBlock() + 20);
        bids[1] = _bid(a, buyerB, 9_000_000, 3000e6);
        vm.roll(a.endBlock());
        vm.prank(settlement);
        a.sweepCurrency();
        uint256 raised = IERC20Like(address(teur)).balanceOf(settlement);
        (uint256[] memory refunds, uint256[] memory tokens) = _exitAndClaim(a, bids);
        assertEq(raised, a.currencyRaised());
        assertGt(tokens[0] + tokens[1], 0);
        assertLe(5000e6 - raised - refunds[0] - refunds[1], 10, "currency dust");
    }
}
