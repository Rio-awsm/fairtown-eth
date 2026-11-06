// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {SettlementFixture} from "../utils/SettlementFixture.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {ChainTrigger} from "../../src/ChainTrigger.sol";
import {MarketSettlement} from "../../src/MarketSettlement.sol";
import {Keys} from "../../src/libraries/Keys.sol";

/// S1 3.1: relists with decaying floors (D-60), truck, storage and compute lots, chained truck relists (D-61),
/// sector roles and parents (D-62), and the refunded status kept through releaseExpired.
contract MarketExtensionsTest is SettlementFixture {
    event TransportNeeded(
        uint256 indexed lotId, bytes32 indexed fromMarket, bytes32 place, uint256 qty, uint64 readyByBlock
    );
    event StorageNeeded(uint256 indexed lotId, address indexed requester, uint256 qty, uint16 days_);
    event LotRelisted(uint256 indexed lotId, uint256 indexed newLotId, uint256 newFloorPerUnit);
    event LotDelivered(uint256 indexed lotId, uint256 truckLotId);
    event LotPaidInFull(uint256 indexed lotId);

    uint8 constant SOLD = 2;
    uint8 constant PICKED_UP = 4;
    uint8 constant PAID_IN_FULL = 5;
    uint8 constant REFUNDED = 9;
    uint8 constant RELISTED = 10;

    function setUp() public {
        vm.roll(100);
        _etchPermit2();
        _deploy(DEFAULT_SHARE_BPS);
    }

    // ================================================================== relists

    /// Guide 3.1: cod 600 kg at EUR 9 sells 30%, the relist at EUR 7.65 sells the rest. Exact balances.
    function test_relist_cod600At9Sells30Pct_relistAt765SellsRest() public {
        LotFactory.LotSpec memory cod = _cod(address(teur));
        cod.floorPerUnit = 9_000_000;

        // 180 kg at 9.00 = EUR 1,620: fee 16.20, new-seller advance 801.90, held 801.90.
        (uint256 lot1, uint256 tokA) = _sellTo(cod, buyerA, 1620e6);
        MarketSettlement.Sale memory s1 = ms.saleOf(lot1);
        // The floor is rounded down to a tick, so CCA clears a few wei over 180 kg (D-63).
        assertApproxEqAbs(s1.soldTokens, 180e18, ms.TOKEN_DUST(), "30% sold");
        assertApproxEqAbs(s1.soldTokens + s1.unsold, 600e18, 10, "cleared + swept = supply, up to CCA wei rounding");
        assertEq(_bal(address(teur), treasury), 16_200_000);
        assertEq(_bal(address(teur), ingrid), 801_900_000);
        (uint256 held1,,,) = ms.heldOf(lot1);
        assertEq(held1, 801_900_000);

        address oldToken = factory.getLot(lot1).token;
        vm.expectEmit(address(ms));
        emit LotRelisted(lot1, lot1 + 1, 7_650_000);
        vm.prank(ingrid);
        uint256 lot2 = ms.relist(lot1, 7_650_000, 45);
        LotFactory.Lot memory l2 = factory.getLot(lot2);
        assertEq(l2.spec.qty, 420, "dust under a whole kg is not lost (D-63)");
        assertEq(l2.spec.floorPerUnit, 7_650_000);
        assertEq(l2.spec.parentLotId, lot1);
        assertTrue(l2.token != oldToken, "new token per relist");
        assertEq(_bal(oldToken, address(ms)), 0, "unsold burned");
        assertEq(ms.statusOf(lot1), SOLD, "a partly sold lot stays sold");

        // 420 kg at 7.65 = EUR 3,213: fee 32.13, advance 1,590.435, held 1,590.435.
        uint256 tokB = _bidSettleClaim(lot2, buyerB, 3213e6);
        MarketSettlement.Sale memory s2 = ms.saleOf(lot2);
        assertApproxEqAbs(s2.soldTokens, 420e18, ms.TOKEN_DUST(), "the rest sold");
        assertLt(s2.unsold, ms.TOKEN_DUST());
        assertEq(_bal(address(teur), treasury), 16_200_000 + 32_130_000);
        assertEq(_bal(address(teur), ingrid), 801_900_000 + 1_590_435_000);
        (uint256 held2,,,) = ms.heldOf(lot2);
        assertEq(held2, 1_590_435_000);

        _handover(lot1, buyerA, tokA, buyerA, ingridKey);
        _handover(lot2, buyerB, tokB, buyerB, ingridKey);
        assertEq(_bal(address(teur), ingrid), 1_603_800_000 + 3_180_870_000, "seller: raised minus fees");
        assertEq(_bal(address(teur), treasury), 48_330_000);
        assertEq(_bal(address(teur), address(ms)), 0, "nothing stuck");
        assertEq(ms.statusOf(lot1), PAID_IN_FULL);
        assertEq(ms.statusOf(lot2), PAID_IN_FULL);
        (uint32 clean,,) = ms.sellerRecord(ingrid);
        assertEq(clean, 2);
    }

    /// D-60: every relist in a chain stays at or above half the chain's first floor.
    function test_relistFloor_neverBelowHalfOfFirstFloor() public {
        LotFactory.LotSpec memory cod = _cod(address(teur));
        cod.floorPerUnit = 9_000_000;
        uint256 lot1 = _listNoBids(cod);
        assertEq(ms.minRelistFloorOf(lot1), 4_500_000);

        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorBelowMinimum.selector, 4_499_999, 4_500_000));
        vm.prank(ingrid);
        ms.relist(lot1, 4_499_999, 45);

        vm.prank(ingrid);
        uint256 lot2 = ms.relist(lot1, 6_000_000, 45);
        assertEq(ms.minRelistFloorOf(lot2), 4_500_000, "the chain keeps its first floor");
        _settleNoBids(lot2);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorBelowMinimum.selector, 4_000_000, 4_500_000));
        vm.prank(op); // the operator is held to the same rule
        ms.relist(lot2, 4_000_000, 45);

        vm.prank(ingrid);
        uint256 lot3 = ms.relist(lot2, 4_500_000, 45); // exactly the minimum
        assertEq(ms.statusOf(lot2), RELISTED);
        _settleNoBids(lot3);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorNotLower.selector, 4_500_000, 4_500_000));
        vm.prank(ingrid);
        ms.relist(lot3, 4_500_000, 45);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorBelowMinimum.selector, 4_499_999, 4_500_000));
        vm.prank(ingrid);
        ms.relist(lot3, 4_499_999, 45);

        // At the bottom of the chain the seller can still close it: unsold burned, goods kept (D-43).
        vm.prank(ingrid);
        ms.reclaimUnsold(lot3);
        assertEq(_bal(factory.getLot(lot3).token, address(ms)), 0);
    }

    function test_relistFloor_roundsUpAndNeverBelowProductMinimum() public {
        LotFactory.LotSpec memory cod = _cod(address(teur));
        cod.floorPerUnit = 7_500_001;
        uint256 a = _listNoBids(cod);
        assertEq(ms.minRelistFloorOf(a), 3_750_001, "half, rounded up");

        cod.floorPerUnit = 1001; // half is 501, below the 0.001 product minimum
        uint256 b = _listNoBids(cod);
        assertEq(factory.MIN_FLOOR_PER_UNIT(), 1000, "settlement mirrors the factory minimum");
        assertEq(ms.minRelistFloorOf(b), 1000);
        vm.prank(ingrid);
        uint256 c = ms.relist(b, 1000, 45);
        assertEq(factory.getLot(c).spec.floorPerUnit, 1000);
    }

    function testFuzz_relistFloorRule(uint256 first, uint256 next) public {
        first = bound(first, 2001, 1e12);
        next = bound(next, 1000, first - 1);
        LotFactory.LotSpec memory cod = _cod(address(teur));
        cod.qty = 10;
        cod.floorPerUnit = first;
        uint256 lot = _listNoBids(cod);
        uint256 minFloor = (first + 1) / 2; // ceil(first / 2), at least 1,001 here
        if (next < minFloor) {
            vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorBelowMinimum.selector, next, minFloor));
            vm.prank(ingrid);
            ms.relist(lot, next, 45);
        } else {
            vm.prank(ingrid);
            uint256 n = ms.relist(lot, next, 45);
            assertEq(factory.getLot(n).spec.floorPerUnit, next);
            assertEq(ms.minRelistFloorOf(n), minFloor);
        }
    }

    // ================================================================== trucks

    /// Guide 3.1: chained truck lot, 10% advance, the drop-off ticket emits LotDelivered(parent, truck) and
    /// LotPaidInFull(parent).
    function test_truckChained_tenPctAdvance_dropOffDeliversParentAndPaysInFull() public {
        (uint256 fishLot, uint256 fishTokens) = _sellTo(_cod(address(teur)), buyerA, 1000e6);
        uint256 tre0 = _bal(address(teur), treasury);

        // EUR 50: fee 0.50, truck advance 10% of 49.50 = 4.95, held 44.55.
        (uint256 truckLot, uint256 truckTokens) = _sellTo(_truckSpec(fishLot), buyerA, 50e6);
        assertEq(ms.saleOf(truckLot).advanceBps, TRUCK_BPS);
        assertEq(_bal(address(teur), lars), 4_950_000);
        assertEq(_bal(address(teur), treasury) - tre0, 500_000);
        (uint256 held,,,) = ms.heldOf(truckLot);
        assertEq(held, 44_550_000);

        ms.assignCarrier(fishLot, truckLot);
        _handover(fishLot, buyerA, fishTokens, lars, ingridKey); // pickup: the carrier scans the seller's code
        assertEq(ms.statusOf(fishLot), PICKED_UP);

        vm.recordLogs();
        _handover(truckLot, buyerA, truckTokens, buyerA, larsKey); // drop-off: the buyer scans the truck's code
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 d = _indexOf(logs, LotDelivered.selector, fishLot);
        assertEq(abi.decode(logs[d].data, (uint256)), truckLot, "LotDelivered(parent, truck)");
        assertLt(d, _indexOf(logs, LotPaidInFull.selector, fishLot));
        _indexOf(logs, LotPaidInFull.selector, truckLot);
        assertEq(_bal(address(teur), lars), 49_500_000, "carrier paid in full");
        assertEq(ms.statusOf(fishLot), PAID_IN_FULL);
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    /// D-61: a relisted truck lot keeps its history in the spec but serves the goods lot in settlement.
    function test_relistedTruckLotCarriesTheGoodsLot() public {
        (uint256 fishLot, uint256 fishTokens) = _sellTo(_cod(address(teur)), buyerA, 1000e6);
        // First truck lot sells 200 of 600 kg-route, then the rest is relisted lower.
        (uint256 t1,) = _sellTo(_truckSpec(fishLot), buyerB, 20e6);
        vm.prank(lars);
        uint256 t2 = ms.relist(t1, 80_000, 30);
        assertEq(factory.getLot(t2).spec.parentLotId, t1, "spec keeps relist history");
        uint256 t2Tokens = _bidSettleClaim(t2, buyerA, 32e6); // 400 kg-route at 0.08
        assertEq(ms.saleOf(t2).parentLotId, fishLot, "settlement resolves the goods lot");
        assertEq(ms.saleOf(t2).advanceBps, TRUCK_BPS);

        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoTransport.selector, t1));
        ms.assignCarrier(t1, t2); // a truck lot never gets a carrier
        ms.assignCarrier(fishLot, t2);
        (,,, address carrier) = ms.heldOf(fishLot);
        assertEq(carrier, lars);

        _handover(fishLot, buyerA, fishTokens, lars, ingridKey);
        vm.recordLogs();
        _handover(t2, buyerA, t2Tokens, buyerA, larsKey);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 d = _indexOf(logs, LotDelivered.selector, fishLot);
        assertEq(abi.decode(logs[d].data, (uint256)), t2);
        _indexOf(logs, LotPaidInFull.selector, fishLot);
        assertEq(ms.statusOf(fishLot), PAID_IN_FULL);
    }

    function test_truckRelistChainResolvesThroughTwoHops() public {
        (uint256 fishLot,) = _sellTo(_cod(address(teur)), buyerA, 1000e6);
        uint256 t1 = _listNoBids(_truckSpec(fishLot));
        vm.prank(lars);
        uint256 t2 = ms.relist(t1, 90_000, 30);
        _settleNoBids(t2);
        vm.prank(lars);
        uint256 t3 = ms.relist(t2, 80_000, 30);
        assertEq(factory.getLot(t3).spec.parentLotId, t2);
        _bidSettleClaim(t3, buyerA, 40e6);
        assertEq(ms.saleOf(t1).parentLotId, fishLot);
        assertEq(ms.saleOf(t2).parentLotId, fishLot);
        assertEq(ms.saleOf(t3).parentLotId, fishLot);
        ms.assignCarrier(fishLot, t3);
        assertEq(ms.saleOf(fishLot).truckLotId, t3);
    }

    /// Guide 3.1: Dallas standalone truck lot (no parent). Direct handover, no transport trigger.
    function test_dallasStandaloneTruckLot() public {
        LotFactory.LotSpec memory s = _truckSpec(0);
        s.seller = maya;
        s.place = "dallas";
        vm.recordLogs();
        (uint256 lot, uint256 tokens) = _sellTo(s, buyerC, 50e6);
        _assertNoEvent(vm.getRecordedLogs(), TransportNeeded.selector);
        assertEq(ms.saleOf(lot).parentLotId, 0);
        assertEq(_bal(address(teur), maya), 4_950_000, "10% advance");

        vm.recordLogs();
        _handover(lot, buyerC, tokens, buyerC, mayaKey);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 d = _indexOf(logs, LotDelivered.selector, lot);
        assertEq(abi.decode(logs[d].data, (uint256)), 0, "direct: truckLotId 0");
        _indexOf(logs, LotPaidInFull.selector, lot);
        assertEq(_bal(address(teur), maya), 49_500_000);
        assertEq(ms.statusOf(lot), PAID_IN_FULL);
    }

    function test_dallasTruckRelistStaysStandalone() public {
        LotFactory.LotSpec memory s = _truckSpec(0);
        s.seller = maya;
        uint256 t1 = _listNoBids(s);
        vm.prank(maya);
        uint256 t2 = ms.relist(t1, 85_000, 30);
        uint256 tokens = _bidSettleClaim(t2, buyerC, 17e6);
        assertEq(ms.saleOf(t2).parentLotId, 0, "standalone chain resolves to no goods lot");
        vm.recordLogs();
        _handover(t2, buyerC, tokens, buyerC, mayaKey);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(abi.decode(logs[_indexOf(logs, LotDelivered.selector, t2)].data, (uint256)), 0);
        assertEq(ms.statusOf(t2), PAID_IN_FULL);
    }

    // ================================================================== compute

    /// Guide 3.1: GPU-hour lot, provider seller, the buyer agent confirms access. No transport, short pickup.
    function test_gpuLot_providerSellsAndBuyerAgentConfirmsAccess() public {
        LotFactory.LotSpec memory s = _gpuSpec();
        vm.recordLogs();
        (uint256 lot, uint256 tokens) = _sellTo(s, buyerA, 120e6); // 100 GPU hours at 1.20
        _assertNoEvent(vm.getRecordedLogs(), TransportNeeded.selector);
        MarketSettlement.Sale memory sale = ms.saleOf(lot);
        assertEq(sale.pickupDeadline, factory.getLot(lot).endBlock + 600, "short pickup window");
        assertApproxEqAbs(sale.soldTokens, 100e18, ms.TOKEN_DUST());
        assertEq(sale.advanceBps, NEW_BPS);
        // fee 1.20, advance 59.40, held 59.40
        assertEq(_bal(address(tusd), northlight), 59_400_000);

        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoTransport.selector, lot));
        ms.assignCarrier(lot, 1);

        vm.recordLogs();
        _handover(lot, buyerA, tokens, buyerA, northlightKey);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(abi.decode(logs[_indexOf(logs, LotDelivered.selector, lot)].data, (uint256)), 0);
        _indexOf(logs, LotPaidInFull.selector, lot);
        assertEq(_bal(address(tusd), northlight), 118_800_000);
        assertEq(_bal(address(tusd), treasury), 1_200_000);
        assertEq(_bal(address(tusd), address(ms)), 0);
    }

    function test_gpuNoShowAfterShortWindow() public {
        (uint256 lot, uint256 tokens) = _sellTo(_gpuSpec(), buyerA, 120e6);
        uint64 deadline = ms.saleOf(lot).pickupDeadline;
        vm.roll(deadline);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TooEarly.selector, deadline));
        vm.prank(buyerA);
        ms.reportNoShow(lot, tokens);
        vm.roll(deadline + 1);
        vm.prank(buyerA);
        ms.reportNoShow(lot, tokens);
        vm.roll(deadline + 1 + CONTEST + 1);
        uint256 before = _bal(address(tusd), buyerA);
        ms.finalizeNoShow(lot, buyerA);
        assertEq(_bal(address(tusd), buyerA) - before, 59_400_000, "held share back to the buyer agent");
        assertEq(ms.statusOf(lot), REFUNDED);
    }

    // ================================================================== storage

    function test_storage_requestForHoldersOnly_andSlotLotChainedToGoods() public {
        (uint256 fishLot, uint256 fishTokens) = _sellTo(_cod(address(teur)), buyerA, 750e6); // 100 kg
        uint256 units = fishTokens / 1e18;

        vm.expectEmit(address(trigger));
        emit StorageNeeded(fishLot, buyerA, units, 3);
        vm.prank(buyerA);
        trigger.requestStorage(fishLot, units, 3);

        vm.expectRevert(
            abi.encodeWithSelector(ChainTrigger.NotAHolder.selector, buyerA, (units + 1) * 1e18, fishTokens)
        );
        vm.prank(buyerA);
        trigger.requestStorage(fishLot, units + 1, 3);
        vm.expectRevert(abi.encodeWithSelector(ChainTrigger.NotAHolder.selector, buyerB, 1e18, 0));
        vm.prank(buyerB);
        trigger.requestStorage(fishLot, 1, 3);
        // The cold store itself holds none of the goods.
        vm.expectRevert(abi.encodeWithSelector(ChainTrigger.NotAHolder.selector, vault, 1e18, 0));
        vm.prank(vault);
        trigger.requestStorage(fishLot, 1, 3);

        LotFactory.LotSpec memory st = _cod(address(teur));
        st.sector = Keys.STORAGE;
        st.market = "cold_vault";
        st.commodity = "storage_slot";
        st.grade = "na";
        st.qty = 10;
        st.floorPerUnit = 2_000_000; // 2.00 per slot-day
        st.pickupWindowBlocks = 1500;
        st.parentLotId = fishLot;
        st.seller = vault;
        vm.recordLogs();
        (uint256 stLot, uint256 stTokens) = _sellTo(st, buyerA, 6e6); // 3 slot-days
        _assertNoEvent(vm.getRecordedLogs(), TransportNeeded.selector);
        assertEq(factory.getLot(stLot).spec.parentLotId, fishLot);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoTransport.selector, stLot));
        ms.assignCarrier(stLot, 1);

        _handover(stLot, buyerA, stTokens, buyerA, vaultKey);
        assertEq(ms.statusOf(stLot), PAID_IN_FULL);
        assertEq(_bal(address(teur), vault), 5_940_000, "6.00 minus 1% fee");
    }

    // ================================================================== status fix (2.1 NOTES)

    /// A lot with a finalized refund stays `refunded` when the rest is released (was overwritten to picked_up).
    function test_releaseAfterRefundKeepsRefundedStatus() public {
        address[] memory who = new address[](2);
        uint256[] memory maxP = new uint256[](2);
        uint256[] memory amt = new uint256[](2);
        (who[0], who[1]) = (buyerA, buyerB);
        (maxP[0], maxP[1]) = (15_000_000, 15_000_000);
        (amt[0], amt[1]) = (500e6, 500e6);
        (uint256 lot, uint256[] memory tokens,) = _sell(_cod(address(teur)), who, maxP, amt);
        uint64 deadline = ms.saleOf(lot).pickupDeadline;

        vm.roll(deadline + 1);
        vm.prank(buyerA);
        ms.reportNoShow(lot, tokens[0]);
        vm.roll(deadline + 1 + CONTEST + 1);
        ms.finalizeNoShow(lot, buyerA);
        assertEq(ms.statusOf(lot), REFUNDED);

        vm.roll(deadline + REPORT + 1);
        ms.releaseExpired(lot);
        assertEq(ms.statusOf(lot), REFUNDED, "refund is not overwritten");
        assertTrue(ms.saleOf(lot).complete);
        assertFalse(ms.saleOf(lot).paidInFull);
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    function test_releaseWithoutRefundStillPaidInFull() public {
        (uint256 lot,) = _sellTo(_cod(address(teur)), buyerA, 500e6);
        vm.roll(ms.saleOf(lot).pickupDeadline + REPORT + 1);
        ms.releaseExpired(lot);
        assertEq(ms.statusOf(lot), PAID_IN_FULL);
    }

    // ================================================================== helpers

    function _gpuSpec() internal view returns (LotFactory.LotSpec memory s) {
        s = _cod(address(tusd));
        s.sector = Keys.COMPUTE;
        s.market = "compute_yard";
        s.commodity = "gpu_hour";
        s.grade = "gpu_verified";
        s.place = "any_dc";
        s.qty = 200;
        s.floorPerUnit = 1_200_000; // 1.20 per GPU hour
        s.pickupWindowBlocks = 600; // PICKUP_COMPUTE (ICR-003)
        s.seller = northlight;
        s.metadataURI = "ipfs://gpu-200";
    }

    function _listNoBids(LotFactory.LotSpec memory spec) internal returns (uint256 lotId) {
        (lotId,) = _list(spec);
        _settleNoBids(lotId);
    }

    function _settleNoBids(uint256 lotId) internal {
        vm.roll(factory.getLot(lotId).endBlock);
        ms.settle(lotId);
    }

    /// For lots created by relist (not through _list): approve the new auction, one bid, settle, exit, claim.
    function _bidSettleClaim(uint256 lotId, address buyer, uint256 amount) internal returns (uint256 tokens) {
        LotFactory.Lot memory l = factory.getLot(lotId);
        IContinuousClearingAuction a = IContinuousClearingAuction(l.auction);
        vm.prank(buyer);
        IAllowanceTransfer(PERMIT2).approve(l.spec.currency, l.auction, type(uint160).max, type(uint48).max);
        vm.roll(l.startBlock);
        Placed[] memory bids = new Placed[](1);
        bids[0] = _bid(a, buyer, l.spec.floorPerUnit * 2, amount);
        vm.roll(l.endBlock);
        ms.settle(lotId);
        (, uint256[] memory t) = _exitAndClaim(a, bids);
        tokens = t[0];
    }
}
