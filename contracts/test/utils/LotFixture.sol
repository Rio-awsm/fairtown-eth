// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {Checkpoint} from "continuous-clearing-auction/libraries/CheckpointLib.sol";
import {Bid} from "continuous-clearing-auction/libraries/BidLib.sol";
import {IDistributorFactory} from "liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {AgentRegistry, IAgentRegistry} from "../../src/registry/AgentRegistry.sol";
import {AgentRegistryHook} from "../../src/registry/AgentRegistryHook.sol";
import {MockStable} from "../../src/tokens/MockStable.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {Keys} from "../../src/libraries/Keys.sol";
import {PriceMath} from "../../src/libraries/PriceMath.sol";

/// Shared setup for LotFactory tests. Settlement is a plain address until S1 1.3.
abstract contract LotFixture is Test {
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 internal constant DEFAULT_SHARE_BPS = 7500; // LAST_BLOCK_SHARE_BPS in .env.example (D-40)

    IDistributorFactory internal ccaFactory;
    AgentRegistry internal reg;
    AgentRegistryHook internal hook;
    MockStable internal teur;
    MockStable internal tusd;
    LotFactory internal factory;

    address internal op = makeAddr("operator");
    address internal settlement = makeAddr("settlement");
    address internal ingrid = makeAddr("ingrid.seller");
    address internal buyerA = makeAddr("buyerA");
    address internal buyerB = makeAddr("buyerB");
    address internal buyerC = makeAddr("buyerC");
    address internal stranger = makeAddr("stranger");
    address[] internal buyers;

    struct Placed {
        uint256 id;
        address owner;
        uint256 amount;
    }

    /// Canonical Permit2 runtime code from Base Sepolia (test/fixtures/permit2.runtime.hex). Permit2 pins solc
    /// 0.8.17, so it cannot be compiled here; plain anvil and the local EVM have none (contracts/NOTES.md).
    function _etchPermit2() internal {
        string memory hexCode = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/permit2.runtime.hex"));
        vm.etch(PERMIT2, vm.parseBytes(vm.trim(hexCode)));
    }

    function _deploy(uint256 shareBps) internal {
        ccaFactory = IDistributorFactory(
            vm.deployCode(
                "ContinuousClearingAuctionFactory.sol:ContinuousClearingAuctionFactory", abi.encode(address(0))
            )
        );
        reg = new AgentRegistry(op);
        hook = new AgentRegistryHook(IAgentRegistry(address(reg)));
        teur = new MockStable("Test EUR", "tEUR", op);
        tusd = new MockStable("Test USD", "tUSD", op);
        factory = new LotFactory(
            op, ccaFactory, IAgentRegistry(address(reg)), address(hook), settlement, address(0), shareBps
        );
        vm.startPrank(op);
        factory.setCurrency(address(teur), true);
        factory.setCurrency(address(tusd), true);
        reg.register(ingrid, reg.SELLER(), "ingrid.seller");
        buyers = [buyerA, buyerB, buyerC];
        for (uint256 i; i < buyers.length; i++) {
            reg.register(buyers[i], reg.BUYER(), "buyer");
            teur.mint(buyers[i], 100_000e6);
            tusd.mint(buyers[i], 100_000e6);
        }
        vm.stopPrank();
        // Once per buyer and currency: approve Permit2 (CCA's invariant test does the same).
        for (uint256 i; i < buyers.length; i++) {
            vm.startPrank(buyers[i]);
            teur.approve(PERMIT2, type(uint256).max);
            tusd.approve(PERMIT2, type(uint256).max);
            vm.stopPrank();
        }
    }

    function _cod(address currency) internal view returns (LotFactory.LotSpec memory) {
        return LotFactory.LotSpec({
            sector: Keys.FISH,
            market: "fish_dock",
            commodity: "cod",
            grade: "fresh_e",
            place: "bergen",
            currency: currency,
            qty: 600,
            floorPerUnit: 7_500_000,
            durationBlocks: 45,
            pickupWindowBlocks: 300,
            parentLotId: 0,
            seller: ingrid,
            metadataURI: "ipfs://cod-600"
        });
    }

    function _list(LotFactory.LotSpec memory spec) internal returns (uint256 lotId, IContinuousClearingAuction a) {
        vm.prank(spec.seller);
        (uint256 id, address auction,) = factory.createLot(spec);
        lotId = id;
        a = IContinuousClearingAuction(auction);
        // Per auction: a Permit2 allowance for the auction as spender.
        for (uint256 i; i < buyers.length; i++) {
            vm.prank(buyers[i]);
            IAllowanceTransfer(PERMIT2).approve(spec.currency, auction, type(uint160).max, type(uint48).max);
        }
    }

    /// Max price on a tick, strictly above the current clearing price.
    function _priceQ96(IContinuousClearingAuction a, uint256 perUnit) internal view returns (uint256) {
        return PriceMath.ceilToTick(PriceMath.toQ96(perUnit), a.tickSpacing());
    }

    function _bid(IContinuousClearingAuction a, address who, uint256 maxPerUnit, uint256 amount)
        internal
        returns (Placed memory)
    {
        // Compute first: an external view call inside the argument list would consume the prank.
        uint256 price = _priceQ96(a, maxPerUnit);
        vm.prank(who);
        uint256 id = a.submitBid(price, uint128(amount), who, "");
        return Placed(id, who, amount);
    }

    /// Exit hints, found by walking the checkpoint list back from the final checkpoint:
    /// outbidBlock = earliest checkpoint with clearing > maxPrice (0 if never outbid, i.e. final == maxPrice);
    /// lastFullyFilled = the latest checkpoint with clearing < maxPrice.
    function _hints(IContinuousClearingAuction a, uint256 bidId)
        internal
        view
        returns (uint64 lastFullyFilled, uint64 outbidBlock)
    {
        uint256 maxPrice = a.bids(bidId).maxPrice;
        uint64 b = a.lastCheckpointedBlock();
        while (b != 0) {
            Checkpoint memory cp = a.checkpoints(b);
            if (cp.clearingPrice > maxPrice) outbidBlock = b;
            if (cp.clearingPrice < maxPrice) return (b, outbidBlock);
            b = cp.prev;
        }
        revert("no fully filled checkpoint");
    }

    /// Exits every bid the right way, then claims. Returns currency refunded and tokens received per bid.
    function _exitAndClaim(IContinuousClearingAuction a, Placed[] memory bids)
        internal
        returns (uint256[] memory refunds, uint256[] memory tokens)
    {
        refunds = new uint256[](bids.length);
        tokens = new uint256[](bids.length);
        IERC20Like cur = IERC20Like(a.currency());
        IERC20Like tok = IERC20Like(a.token());
        // Hints must be computed against the final state: checkpoint the end block first (keeper does the same).
        a.checkpoint();
        uint256 finalClearing = a.clearingPrice();
        for (uint256 i; i < bids.length; i++) {
            uint256 before = cur.balanceOf(bids[i].owner);
            if (a.bids(bids[i].id).maxPrice > finalClearing) {
                a.exitBid(bids[i].id);
            } else {
                (uint64 lf, uint64 ob) = _hints(a, bids[i].id);
                a.exitPartiallyFilledBid(bids[i].id, lf, ob);
            }
            refunds[i] = cur.balanceOf(bids[i].owner) - before;
        }
        for (uint256 i; i < bids.length; i++) {
            uint256 before = tok.balanceOf(bids[i].owner);
            a.claimTokens(bids[i].id);
            tokens[i] = tok.balanceOf(bids[i].owner) - before;
        }
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}
