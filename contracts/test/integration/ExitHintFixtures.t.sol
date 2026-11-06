// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {Checkpoint} from "continuous-clearing-auction/libraries/CheckpointLib.sol";
import {LotFixture, IERC20Like} from "../utils/LotFixture.sol";
import {PriceMath} from "../../src/libraries/PriceMath.sol";

/// Writes services/keeper/test/fixtures/exit-hints.json from a real CCA v2.1.0 auction, so the keeper's TypeScript
/// hint walk (S1 2.1, exits.ts) is tested against the same checkpoint list the contract validates. One auction covers
/// all three exit paths: outbid (partial exit with an outbid block), partly filled at the final price (outbid 0), and
/// above the final price (exitBid). The file is deterministic: a rerun shows no diff.
contract ExitHintFixturesTest is LotFixture {
    string internal constant OUT = "/../services/keeper/test/fixtures/exit-hints.json";
    address internal buyerD = makeAddr("buyerD");

    function setUp() public {
        _etchPermit2();
        vm.roll(100);
        _deploy(DEFAULT_SHARE_BPS);
        // A fourth buyer for the 4-bid auction.
        vm.startPrank(op);
        reg.register(buyerD, reg.BUYER(), "buyer");
        teur.mint(buyerD, 100_000e6);
        vm.stopPrank();
        vm.prank(buyerD);
        teur.approve(PERMIT2, type(uint256).max);
        buyers.push(buyerD);
    }

    function test_writeExitHintFixtures() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur))); // 600 kg at EUR 7.50, 45 blocks
        Placed[] memory bids = new Placed[](4);
        uint64 start = a.startBlock();
        vm.roll(start);
        bids[0] = _bid(a, buyerA, 7_650_000, 500e6); // A: max 7.65, outbid once B arrives
        vm.roll(start + 2);
        bids[1] = _bid(a, buyerC, 8_000_000, 1000e6); // C: max 8.025 (ticked), partly filled at the end
        vm.roll(start + 5);
        bids[2] = _bid(a, buyerB, 8_000_000, 8000e6); // B: same tick, demand above supply pins the clearing price
        vm.roll(start + 20);
        bids[3] = _bid(a, buyerD, 10_000_000, 1000e6); // D: max 10.05, above the final price
        // The keeper checkpoints every so often (D-54); here every 5 blocks.
        for (uint64 b = start + 25; b < a.endBlock(); b += 5) {
            vm.roll(b);
            a.checkpoint();
        }
        vm.roll(a.endBlock());
        a.checkpoint(); // what settle's sweep does (ensureEndBlockIsCheckpointed)
        assertEq(a.lastCheckpointedBlock(), a.endBlock(), "end block checkpointed");

        uint256 finalClearing = a.clearingPrice();
        assertLt(a.bids(bids[0].id).maxPrice, finalClearing, "A outbid");
        assertEq(a.bids(bids[1].id).maxPrice, finalClearing, "C at final");
        assertEq(a.bids(bids[2].id).maxPrice, finalClearing, "B at final");
        assertGt(a.bids(bids[3].id).maxPrice, finalClearing, "D above final");

        string memory cpsOut = _serializeCheckpoints(a);
        // Expected hints per bid, from the Solidity walk in LotFixture._hints; then exit with them to prove validity.
        string memory bsOut;
        string[4] memory names = ["A_outbid", "C_atFinal", "B_atFinal", "D_aboveFinal"];
        for (uint256 i; i < 4; i++) {
            bsOut = vm.serializeString("bids", names[i], _serializeAndExit(a, bids[i].id, names[i], i == 0));
        }

        // Every exit worked; claims give tokens to everyone but the outbid A (who got a refund).
        IERC20Like tok = IERC20Like(a.token());
        for (uint256 i; i < 4; i++) {
            a.claimTokens(bids[i].id);
        }
        assertGt(tok.balanceOf(buyerB), 0, "B claimed");
        assertGt(tok.balanceOf(buyerC), 0, "C claimed");
        assertGt(tok.balanceOf(buyerD), 0, "D claimed");

        string memory root = "root";
        vm.serializeString(root, "finalClearing", vm.toString(finalClearing));
        vm.serializeString(root, "finalPerUnit", vm.toString(PriceMath.fromQ96(finalClearing)));
        vm.serializeString(root, "lastCheckpointed", vm.toString(a.lastCheckpointedBlock()));
        vm.serializeString(root, "endBlock", vm.toString(a.endBlock()));
        vm.serializeString(root, "checkpoints", cpsOut);
        string memory out = vm.serializeString(root, "bids", bsOut);
        vm.writeJson(out, string.concat(vm.projectRoot(), OUT));

        string memory json = vm.readFile(string.concat(vm.projectRoot(), OUT));
        assertEq(vm.parseJsonKeys(json, ".bids").length, 4);
    }

    function _serializeCheckpoints(IContinuousClearingAuction a) internal returns (string memory out) {
        uint64 blk = a.lastCheckpointedBlock();
        while (blk != 0) {
            Checkpoint memory cp = a.checkpoints(blk);
            string memory k = vm.toString(blk);
            vm.serializeString(k, "clearingPrice", vm.toString(cp.clearingPrice));
            out = vm.serializeString("checkpoints", k, vm.serializeString(k, "prev", vm.toString(cp.prev)));
            blk = cp.prev;
        }
    }

    function _serializeAndExit(IContinuousClearingAuction a, uint256 id, string memory k, bool expectOutbid)
        internal
        returns (string memory)
    {
        uint256 maxPrice = a.bids(id).maxPrice;
        vm.serializeString(k, "id", vm.toString(id));
        vm.serializeString(k, "maxPrice", vm.toString(maxPrice));
        vm.serializeString(k, "startBlock", vm.toString(a.bids(id).startBlock));
        if (maxPrice > a.clearingPrice()) {
            a.exitBid(id);
            return vm.serializeString(k, "path", "exitBid");
        }
        (uint64 lf, uint64 ob) = _hints(a, id);
        if (expectOutbid) assertGt(ob, 0, "outbid bid has an outbid block");
        else assertEq(ob, 0, "at-final bid has no outbid block");
        vm.serializeString(k, "lastFullyFilled", vm.toString(lf));
        vm.serializeString(k, "outbid", vm.toString(ob));
        a.exitPartiallyFilledBid(id, lf, ob);
        return vm.serializeString(k, "path", "partial");
    }
}
