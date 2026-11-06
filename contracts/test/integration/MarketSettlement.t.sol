// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SettlementFixture} from "../utils/SettlementFixture.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {ChainTrigger} from "../../src/ChainTrigger.sol";
import {MarketSettlement} from "../../src/MarketSettlement.sol";
import {Keys} from "../../src/libraries/Keys.sol";

contract MarketSettlementTest is SettlementFixture {
    event LotSettled(
        uint256 indexed lotId,
        uint256 finalClearingPerUnit,
        uint256 avgPerUnit,
        uint256 soldUnits,
        uint256 raised,
        uint256 sellerPaid,
        uint256 held,
        uint256 fee,
        uint16 advanceBps,
        uint64 pickupDeadline
    );
    event TransportNeeded(
        uint256 indexed lotId, bytes32 indexed fromMarket, bytes32 place, uint256 qty, uint64 readyByBlock
    );
    event LotDelivered(uint256 indexed lotId, uint256 truckLotId);
    event LotPaidInFull(uint256 indexed lotId);

    // LOT_STATUS indexes
    uint8 constant UNSOLD = 1;
    uint8 constant SOLD = 2;
    uint8 constant TRUCK_BOOKED = 3;
    uint8 constant PICKED_UP = 4;
    uint8 constant PAID_IN_FULL = 5;
    uint8 constant DELIVERED = 6;
    uint8 constant NO_SHOW_REPORTED = 7;
    uint8 constant DISPUTED = 8;
    uint8 constant REFUNDED = 9;
    uint8 constant RELISTED = 10;

    function setUp() public {
        vm.roll(100);
        _etchPermit2();
        _deploy(DEFAULT_SHARE_BPS);
    }

    function _bigCod() internal view returns (LotFactory.LotSpec memory s) {
        s = _cod(address(teur));
        s.qty = 1000; // capacity at the floor: EUR 7,500, so a EUR 5,460 bid fills fully at the floor
    }

    // ================================================================== tiers, exact balances

    /// Guide 1.3: EUR 5,460 raised, new seller: 54.60 fee, 2,702.70 advance, 2,702.70 held.
    function test_settle_newTierExactBalances() public {
        uint256 ingridBefore = _bal(address(teur), ingrid);
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 5460e6);
        (uint256 held, uint256 sold,,) = ms.heldOf(lotId);
        assertEq(_bal(address(teur), treasury), 54_600_000, "fee 54.60");
        assertEq(_bal(address(teur), ingrid) - ingridBefore, 2_702_700_000, "advance 2,702.70");
        assertEq(held, 2_702_700_000, "held 2,702.70");
        assertEq(_bal(address(teur), address(ms)), held, "settlement holds exactly the held money");
        assertEq(sold, tokens, "buyer claimed every sold token");
        assertEq(ms.statusOf(lotId), SOLD);
    }

    /// SoT 8.4 table: 1,000.00 raised, proven: 891.00 now, 99.00 held.
    function test_settle_provenTier() public {
        vm.prank(op);
        ms.markProven(ingrid, true);
        assertEq(ms.advanceBpsFor(ingrid, Keys.FISH), PROVEN_BPS);
        (uint256 lotId,) = _sellTo(_bigCod(), buyerA, 1000e6);
        (uint256 held,,,) = ms.heldOf(lotId);
        assertEq(_bal(address(teur), treasury), 10e6);
        assertEq(held, 99e6);
        assertEq(ms.saleOf(lotId).advanceBps, PROVEN_BPS);
    }

    function test_settle_truckTierAlways10Pct() public {
        (uint256 fishLot,) = _sellTo(_bigCod(), buyerA, 1000e6);
        vm.prank(op);
        ms.markProven(lars, true); // even a proven carrier gets the truck tier
        (uint256 truckLot,) = _sellTo(_truckSpec(fishLot), buyerA, 50e6);
        (uint256 held,,,) = ms.heldOf(truckLot);
        // fee 0.50, net 49.50, advance 4.95, held 44.55
        assertEq(held, 44_550_000);
        assertEq(ms.saleOf(truckLot).advanceBps, TRUCK_BPS);
    }

    function test_settle_emitsLotSettled() public {
        LotFactory.LotSpec memory spec = _bigCod();
        (uint256 lotId,) = _list(spec);
        vm.roll(factory.getLot(lotId).startBlock);
        _bid(_auctionOf(lotId), buyerA, 15_000_000, 5460e6);
        vm.roll(factory.getLot(lotId).endBlock);
        uint64 deadline = uint64(vm.getBlockNumber()) + 300;
        // avg 7.50 per kg; 728 kg sold (5460 / 7.5); fee/advance/held as above
        vm.expectEmit(true, false, false, false, address(ms));
        emit LotSettled(lotId, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        ms.settle(lotId);
        MarketSettlement.Sale memory s = ms.saleOf(lotId);
        assertEq(s.pickupDeadline, deadline);
        assertEq(s.heldRemaining, 2_702_700_000);
    }

    function test_RevertWhen_settleEarlyOrTwice() public {
        (uint256 lotId,) = _list(_bigCod());
        uint64 end = factory.getLot(lotId).endBlock;
        vm.roll(end - 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.AuctionNotOver.selector, lotId, end));
        ms.settle(lotId);
        vm.roll(end);
        ms.settle(lotId);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.AlreadySettled.selector, lotId));
        ms.settle(lotId);
    }

    // ================================================================== zero bids, relist, reclaim

    function test_zeroBids_noPayoutNoTransportReclaimBurns() public {
        (uint256 lotId,) = _list(_cod(address(teur)));
        vm.roll(factory.getLot(lotId).endBlock);
        vm.recordLogs();
        ms.settle(lotId);
        _assertNoEvent(vm.getRecordedLogs(), TransportNeeded.selector);
        assertEq(_bal(address(teur), treasury), 0);
        assertEq(_bal(address(teur), address(ms)), 0);
        assertEq(ms.statusOf(lotId), UNSOLD);
        address token = factory.getLot(lotId).token;
        assertEq(_bal(token, address(ms)), 600e18);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotSeller.selector, stranger));
        vm.prank(stranger);
        ms.reclaimUnsold(lotId);
        vm.prank(ingrid);
        ms.reclaimUnsold(lotId);
        assertEq(_bal(token, address(ms)), 0, "unsold burned (D-43)");
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NothingUnsold.selector, lotId));
        vm.prank(ingrid);
        ms.reclaimUnsold(lotId);
    }

    function test_relistBurnsUnsoldAndUsesNewToken() public {
        (uint256 lotId,) = _list(_cod(address(teur)));
        vm.roll(factory.getLot(lotId).endBlock);
        ms.settle(lotId);
        address oldToken = factory.getLot(lotId).token;
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorNotLower.selector, 7_500_000, 7_500_000));
        vm.prank(ingrid);
        ms.relist(lotId, 7_500_000, 45);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.FloorNotLower.selector, 8_000_000, 7_500_000));
        vm.prank(ingrid);
        ms.relist(lotId, 8_000_000, 45);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotSellerOrOperator.selector, stranger));
        vm.prank(stranger);
        ms.relist(lotId, 6_375_000, 45);

        vm.prank(ingrid);
        uint256 newLot = ms.relist(lotId, 6_375_000, 45);
        LotFactory.Lot memory n = factory.getLot(newLot);
        assertEq(_bal(oldToken, address(ms)), 0, "old unsold burned");
        assertTrue(n.token != oldToken, "new token");
        assertEq(n.spec.qty, 600);
        assertEq(n.spec.floorPerUnit, 6_375_000);
        assertEq(n.spec.parentLotId, lotId);
        assertEq(ms.statusOf(lotId), RELISTED);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NothingUnsold.selector, lotId));
        vm.prank(ingrid);
        ms.relist(lotId, 6_000_000, 45);
    }

    // ================================================================== handover

    function test_directHandover_paysHeldAndPaidInFull() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 5460e6);
        uint256 before = _bal(address(teur), ingrid);
        vm.recordLogs();
        _handover(lotId, buyerA, tokens, buyerA, ingridKey);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_bal(address(teur), ingrid) - before, 2_702_700_000, "held released");
        assertEq(_bal(address(teur), address(ms)), 0);
        assertEq(_bal(factory.getLot(lotId).token, buyerA), 0, "tokens burned");
        assertEq(ms.statusOf(lotId), PAID_IN_FULL);
        // Order: LotDelivered(lot, 0) before LotPaidInFull(lot)
        uint256 d = _indexOf(logs, LotDelivered.selector, lotId);
        uint256 p = _indexOf(logs, LotPaidInFull.selector, lotId);
        assertLt(d, p);
        (uint32 clean,,) = ms.sellerRecord(ingrid);
        assertEq(clean, 1);
    }

    function test_twoBuyersShareSumsToHeld() public {
        address[] memory who = new address[](2);
        uint256[] memory maxP = new uint256[](2);
        uint256[] memory amt = new uint256[](2);
        (who[0], who[1]) = (buyerA, buyerB);
        (maxP[0], maxP[1]) = (15_000_000, 15_000_000);
        (amt[0], amt[1]) = (1_234_567_891, 2_345_678_912);
        (uint256 lotId, uint256[] memory tokens,) = _sell(_bigCod(), who, maxP, amt);
        (uint256 held,,,) = ms.heldOf(lotId);
        uint256 before = _bal(address(teur), ingrid);
        _handover(lotId, buyerA, tokens[0], buyerA, ingridKey);
        assertEq(ms.statusOf(lotId), DELIVERED, "one of two handed over");
        _handover(lotId, buyerB, tokens[1], buyerB, ingridKey);
        assertEq(_bal(address(teur), ingrid) - before, held, "shares sum exactly to held");
        assertEq(_bal(address(teur), address(ms)), 0);
        assertEq(ms.statusOf(lotId), PAID_IN_FULL);
    }

    function test_partialHandoversThenDust() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 3_333_333_333);
        (uint256 held,,,) = ms.heldOf(lotId);
        uint256 before = _bal(address(teur), ingrid);
        _handover(lotId, buyerA, tokens / 3, buyerA, ingridKey);
        // Same buyer, amount and expiry would be the same ticket (replay-protected), so the next one is a block later.
        vm.roll(vm.getBlockNumber() + 1);
        _handover(lotId, buyerA, tokens / 3, buyerA, ingridKey);
        _handover(lotId, buyerA, tokens - 2 * (tokens / 3), buyerA, ingridKey);
        assertEq(_bal(address(teur), ingrid) - before, held, "no dust left behind");
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    // The digest the contract checks equals EIP-712 built from the shared package (packages/shared/src/handover.ts):
    // domain { name: "Fairtown", version: "1", chainId, verifyingContract: settlement },
    // Handover(uint256 lotId,address buyer,uint256 tokenAmount,uint64 expiryBlock).
    function test_handoverDigestMatchesSharedTypedData() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Fairtown"),
                keccak256("1"),
                block.chainid,
                address(ms)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Handover(uint256 lotId,address buyer,uint256 tokenAmount,uint64 expiryBlock)"),
                uint256(12),
                buyerA,
                uint256(600e18),
                uint64(4000)
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        assertEq(ms.handoverDigest(12, buyerA, 600e18, 4000), expected);
    }

    function test_RevertWhen_badTickets() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        uint64 expiry = uint64(vm.getBlockNumber() + 10);
        bytes memory good = _ticket(lotId, buyerA, tokens, expiry, ingridKey);

        // wrong signer
        (, uint256 mallory) = makeAddrAndKey("mallory");
        bytes memory forged = _ticket(lotId, buyerA, tokens, expiry, mallory);
        vm.expectRevert(MarketSettlement.BadSignature.selector);
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens, expiry, forged);

        // wrong amount (signature is over the amount)
        vm.expectRevert(MarketSettlement.BadSignature.selector);
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens - 1, expiry, good);

        // wrong buyer field
        vm.expectRevert(MarketSettlement.BadSignature.selector);
        vm.prank(buyerB);
        ms.confirmHandover(lotId, buyerB, tokens, expiry, good);

        // stranger with a valid ticket
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotBuyerOrCarrier.selector, stranger));
        vm.prank(stranger);
        ms.confirmHandover(lotId, buyerA, tokens, expiry, good);

        // expired
        vm.roll(expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TicketExpired.selector, expiry));
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens, expiry, good);
    }

    function test_RevertWhen_ticketReplayed() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        uint64 expiry = uint64(vm.getBlockNumber() + 10);
        bytes memory half = _ticket(lotId, buyerA, tokens / 2, expiry, ingridKey);
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens / 2, expiry, half);
        bytes32 digest = ms.handoverDigest(lotId, buyerA, tokens / 2, expiry);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TicketAlreadyUsed.selector, digest));
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens / 2, expiry, half);
    }

    function test_RevertWhen_handoverMoreThanOwnedOrUnsold() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        uint64 expiry = uint64(vm.getBlockNumber() + 10);
        bytes memory sig = _ticket(lotId, buyerA, tokens + 1, expiry, ingridKey);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.AmountTooHigh.selector, tokens + 1, tokens));
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens + 1, expiry, sig);
        // a zero-bid lot cannot take a handover
        (uint256 empty,) = _list(_cod(address(teur)));
        vm.roll(factory.getLot(empty).endBlock);
        ms.settle(empty);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotSold.selector, empty));
        vm.prank(buyerA);
        ms.confirmHandover(empty, buyerA, 1, expiry, sig);
    }

    // ================================================================== carrier, truck chain

    /// Fish lot -> TransportNeeded -> truck lot (parent = fish lot) -> carrier picks up -> buyer drop-off scan.
    function test_carrierFlow_orderAndPaidInFull() public {
        LotFactory.LotSpec memory fish = _bigCod();
        (uint256 fishLot,) = _list(fish);
        vm.roll(factory.getLot(fishLot).startBlock);
        _bid(_auctionOf(fishLot), buyerA, 15_000_000, 1000e6);
        vm.roll(factory.getLot(fishLot).endBlock);
        vm.expectEmit(true, true, false, false, address(trigger));
        emit TransportNeeded(fishLot, "fish_dock", "bergen", 0, 0);
        ms.settle(fishLot);
        uint256 fishTokens = _claimAll(fishLot, buyerA);
        assertEq(ms.saleOf(fishLot).soldTokens, fishTokens);

        (uint256 truckLot, uint256 truckTokens) = _sellTo(_truckSpec(fishLot), buyerA, 50e6);
        ms.assignCarrier(fishLot, truckLot);
        (,,, address carrier) = ms.heldOf(fishLot);
        assertEq(carrier, lars);
        assertEq(ms.statusOf(fishLot), TRUCK_BOOKED);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.CarrierAlreadyAssigned.selector, fishLot));
        ms.assignCarrier(fishLot, truckLot);

        // Pickup: the carrier scans Ingrid's code.
        vm.recordLogs();
        _handover(fishLot, buyerA, fishTokens, lars, ingridKey);
        Vm.Log[] memory pickup = vm.getRecordedLogs();
        _assertNoEvent(pickup, LotDelivered.selector);
        _assertNoEvent(pickup, LotPaidInFull.selector);
        assertEq(ms.statusOf(fishLot), PICKED_UP);
        assertTrue(ms.saleOf(fishLot).complete, "fish held fully released at pickup");

        // Drop-off: the buyer scans the truck's code.
        vm.recordLogs();
        _handover(truckLot, buyerA, truckTokens, buyerA, larsKey);
        Vm.Log[] memory drop = vm.getRecordedLogs();
        uint256 delivered = _indexOf(drop, LotDelivered.selector, fishLot);
        uint256 truckPaid = _indexOf(drop, LotPaidInFull.selector, truckLot);
        uint256 fishPaid = _indexOf(drop, LotPaidInFull.selector, fishLot);
        assertLt(delivered, truckPaid);
        assertLt(truckPaid, fishPaid);
        // LotDelivered(parent, truck)
        assertEq(abi.decode(drop[delivered].data, (uint256)), truckLot);
        assertEq(ms.statusOf(fishLot), PAID_IN_FULL);
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    function test_RevertWhen_carrierMismatch() public {
        (uint256 fishLot,) = _sellTo(_bigCod(), buyerA, 1000e6);
        (uint256 otherFish,) = _sellTo(_bigCod(), buyerB, 1000e6);
        (uint256 truckLot,) = _sellTo(_truckSpec(otherFish), buyerA, 50e6);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.ParentMismatch.selector, fishLot, otherFish));
        ms.assignCarrier(fishLot, truckLot);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotATruckLot.selector, otherFish));
        ms.assignCarrier(fishLot, otherFish);
        (uint256 unsoldTruck,) = _list(_truckSpec(fishLot));
        vm.roll(factory.getLot(unsoldTruck).endBlock);
        ms.settle(unsoldTruck);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TruckNotSold.selector, unsoldTruck));
        ms.assignCarrier(fishLot, unsoldTruck);
    }

    // ================================================================== transport trigger

    function test_transportNeededOnlyForGoodsThatMove() public {
        bytes32[3] memory none = [Keys.STORAGE, Keys.COMPUTE, Keys.TRUCK];
        address[3] memory lister = [vault, northlight, lars]; // role per sector (D-62)
        for (uint256 i; i < none.length; i++) {
            LotFactory.LotSpec memory s = _bigCod();
            s.sector = none[i];
            s.seller = lister[i];
            vm.recordLogs();
            _sellTo(s, buyerA, 100e6);
            _assertNoEvent(vm.getRecordedLogs(), TransportNeeded.selector);
        }
        bytes32[3] memory yes = [Keys.PRODUCE, Keys.FISH, Keys.FLOWERS];
        for (uint256 i; i < yes.length; i++) {
            LotFactory.LotSpec memory s = _bigCod();
            s.sector = yes[i];
            vm.recordLogs();
            (uint256 lotId,) = _sellTo(s, buyerA, 100e6);
            _indexOf(vm.getRecordedLogs(), TransportNeeded.selector, lotId);
        }
    }

    function test_transportQtyIsWholeUnitsRoundedUp() public {
        // 100 EUR at 7.50 = 13.333... kg sold -> qty 14 (D-42)
        LotFactory.LotSpec memory s = _bigCod();
        (uint256 lotId,) = _list(s);
        vm.roll(factory.getLot(lotId).startBlock);
        _bid(_auctionOf(lotId), buyerA, 15_000_000, 100e6);
        vm.roll(factory.getLot(lotId).endBlock);
        vm.recordLogs();
        ms.settle(lotId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 i = _indexOf(logs, TransportNeeded.selector, lotId);
        (, uint256 qty, uint64 readyBy) = abi.decode(logs[i].data, (bytes32, uint256, uint64));
        assertEq(qty, 14);
        assertEq(readyBy, ms.saleOf(lotId).pickupDeadline);
    }

    function test_triggerAndStorageAuth() public {
        vm.expectRevert(abi.encodeWithSelector(ChainTrigger.NotSettlement.selector, stranger));
        vm.prank(stranger);
        trigger.onSettled(1);
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 750e6); // 100 kg
        assertEq(tokens / 1e18, 100);
        vm.prank(buyerA);
        trigger.requestStorage(lotId, 100, 3);
        vm.expectRevert(abi.encodeWithSelector(ChainTrigger.NotAHolder.selector, stranger, 1e18, 0));
        vm.prank(stranger);
        trigger.requestStorage(lotId, 1, 3);
        vm.expectRevert(ChainTrigger.ZeroQtyOrDays.selector);
        vm.prank(buyerA);
        trigger.requestStorage(lotId, 1, 0);
    }

    // ================================================================== no-show

    function test_noShow_earlyReportReverts_uncontestedRefundExact_recordReset() public {
        // Build a record first: 3 clean lots -> proven.
        for (uint256 i; i < 3; i++) {
            (uint256 l, uint256 t) = _sellTo(_bigCod(), buyerB, 100e6);
            _handover(l, buyerB, t, buyerB, ingridKey);
        }
        (,, bool provenBefore) = ms.sellerRecord(ingrid);
        assertTrue(provenBefore);

        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        (uint256 held,,,) = ms.heldOf(lotId);
        assertEq(held, 99e6, "proven tier on the 4th lot");
        uint64 deadline = ms.saleOf(lotId).pickupDeadline;

        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TooEarly.selector, deadline));
        vm.prank(buyerA);
        ms.reportNoShow(lotId, tokens);

        vm.roll(deadline + 1);
        address lotToken = factory.getLot(lotId).token;
        uint256 escrowBefore = _bal(lotToken, address(ms)); // settlement also holds the unsold tokens
        vm.prank(buyerA);
        ms.reportNoShow(lotId, tokens);
        assertEq(ms.statusOf(lotId), NO_SHOW_REPORTED);
        assertEq(_bal(lotToken, address(ms)) - escrowBefore, tokens, "tokens escrowed without approval");
        assertEq(_bal(lotToken, buyerA), 0);
        (,, bool provenOpen) = ms.sellerRecord(ingrid);
        assertFalse(provenOpen, "an open no-show suspends proven");

        // Handover is blocked while the report is open.
        uint64 exp = uint64(vm.getBlockNumber() + 10);
        bytes memory sig = _ticket(lotId, buyerA, tokens, exp, ingridKey);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoShowOpen.selector, lotId, buyerA));
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, tokens, exp, sig);

        (,, uint64 contestEnds,,) = ms.reportOf(lotId, buyerA);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TooEarly.selector, contestEnds));
        ms.finalizeNoShow(lotId, buyerA);

        vm.roll(contestEnds + 1);
        uint256 before = _bal(address(teur), buyerA);
        ms.finalizeNoShow(lotId, buyerA);
        assertEq(_bal(address(teur), buyerA) - before, held, "held share refunded exactly");
        assertEq(_bal(address(teur), address(ms)), 0);
        assertEq(_bal(lotToken, address(ms)), escrowBefore, "escrow burned");
        assertEq(ms.statusOf(lotId), REFUNDED);
        (uint32 clean, uint32 noShows, bool proven) = ms.sellerRecord(ingrid);
        assertEq(clean, 0, "clean count reset");
        assertEq(noShows, 1);
        assertFalse(proven, "proven cleared");
        assertEq(ms.advanceBpsFor(ingrid, Keys.FISH), NEW_BPS);
    }

    function test_noShow_contestBlocksFinalize() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        vm.roll(ms.saleOf(lotId).pickupDeadline + 1);
        vm.prank(buyerA);
        ms.reportNoShow(lotId, tokens);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotSeller.selector, buyerA));
        vm.prank(buyerA);
        ms.contestNoShow(lotId, buyerA, keccak256("handover photo"), "ipfs://evidence");
        vm.prank(ingrid);
        ms.contestNoShow(lotId, buyerA, keccak256("handover photo"), "ipfs://evidence");
        assertEq(resolver.disputeCount(), 1);
        assertEq(ms.statusOf(lotId), DISPUTED);
        (,,,, uint256 disputeId) = ms.reportOf(lotId, buyerA);
        assertEq(disputeId, 1);
        vm.roll(vm.getBlockNumber() + CONTEST + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.Contested.selector, lotId, buyerA));
        ms.finalizeNoShow(lotId, buyerA);
        // Disputed money is excluded from releaseExpired: it stays held for the ruling (S1 4.1).
        vm.roll(ms.saleOf(lotId).pickupDeadline + REPORT + 1);
        (uint256 heldBefore,,,) = ms.heldOf(lotId);
        ms.releaseExpired(lotId);
        (uint256 heldAfter,,,) = ms.heldOf(lotId);
        assertEq(heldAfter, heldBefore, "all of it is under the ruling");
        assertEq(_bal(address(teur), address(ms)), heldAfter);
    }

    function test_RevertWhen_noShowWindowsAndRules() public {
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        uint64 deadline = ms.saleOf(lotId).pickupDeadline;
        vm.roll(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.AmountTooHigh.selector, tokens + 1, tokens));
        vm.prank(buyerA);
        ms.reportNoShow(lotId, tokens + 1);
        vm.prank(buyerA);
        ms.reportNoShow(lotId, tokens);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.AlreadyReported.selector, lotId, buyerA));
        vm.prank(buyerA);
        ms.reportNoShow(lotId, 1);
        (,, uint64 contestEnds,,) = ms.reportOf(lotId, buyerA);
        vm.roll(contestEnds + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.WindowClosed.selector, contestEnds));
        vm.prank(ingrid);
        ms.contestNoShow(lotId, buyerA, bytes32(0), "");
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoOpenReport.selector, lotId, buyerB));
        ms.finalizeNoShow(lotId, buyerB);
        // Report window closes.
        (uint256 l2, uint256 t2) = _sellTo(_bigCod(), buyerB, 100e6);
        uint64 d2 = ms.saleOf(l2).pickupDeadline;
        vm.roll(d2 + REPORT + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.WindowClosed.selector, d2 + REPORT));
        vm.prank(buyerB);
        ms.reportNoShow(l2, t2);
    }

    function test_RevertWhen_contestWithoutResolver() public {
        withResolver = false;
        _deploy(DEFAULT_SHARE_BPS);
        (uint256 lotId, uint256 tokens) = _sellTo(_bigCod(), buyerA, 1000e6);
        vm.roll(ms.saleOf(lotId).pickupDeadline + 1);
        vm.prank(buyerA);
        ms.reportNoShow(lotId, tokens);
        vm.expectRevert(MarketSettlement.NoResolver.selector);
        vm.prank(ingrid);
        ms.contestNoShow(lotId, buyerA, bytes32(0), "");
        // Uncontested path still ends in a money outcome.
        vm.roll(vm.getBlockNumber() + CONTEST + 1);
        ms.finalizeNoShow(lotId, buyerA);
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    // ================================================================== silence

    function test_buyerSilent_releaseToSellerAfterWindow() public {
        (uint256 lotId,) = _sellTo(_bigCod(), buyerA, 1000e6);
        (uint256 held,,,) = ms.heldOf(lotId);
        uint64 reportEnds = ms.saleOf(lotId).pickupDeadline + REPORT;
        vm.roll(reportEnds);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.TooEarly.selector, reportEnds));
        ms.releaseExpired(lotId);
        vm.roll(reportEnds + 1);
        uint256 before = _bal(address(teur), ingrid);
        ms.releaseExpired(lotId);
        assertEq(_bal(address(teur), ingrid) - before, held);
        assertEq(_bal(address(teur), address(ms)), 0);
        assertEq(ms.statusOf(lotId), PAID_IN_FULL, "silent buyer counts as a clean lot");
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.HeldAlreadyReleased.selector, lotId));
        ms.releaseExpired(lotId);
        // A late ticket after release cannot move money.
        uint64 exp = uint64(vm.getBlockNumber() + 10);
        bytes memory sig = _ticket(lotId, buyerA, 1e18, exp, ingridKey);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.HeldAlreadyReleased.selector, lotId));
        vm.prank(buyerA);
        ms.confirmHandover(lotId, buyerA, 1e18, exp, sig);
    }

    // ================================================================== seller record

    function test_cleanLotsReachProvenAt3() public {
        for (uint256 i; i < 3; i++) {
            assertEq(ms.advanceBpsFor(ingrid, Keys.FISH), NEW_BPS, "still new");
            (uint256 l, uint256 t) = _sellTo(_bigCod(), buyerA, 100e6);
            _handover(l, buyerA, t, buyerA, ingridKey);
        }
        (uint32 clean,, bool proven) = ms.sellerRecord(ingrid);
        assertEq(clean, 3);
        assertTrue(proven);
        assertEq(ms.advanceBpsFor(ingrid, Keys.FISH), PROVEN_BPS);
    }

    function test_markProvenOperatorOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, ms.OPERATOR_ROLE()
            )
        );
        vm.prank(stranger);
        ms.markProven(ingrid, true);
        vm.prank(op);
        ms.markProven(ingrid, true);
        (,, bool proven) = ms.sellerRecord(ingrid);
        assertTrue(proven);
    }

    function test_RevertWhen_rulingNotFromResolverOrNothingOpen() public {
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotResolver.selector, stranger));
        vm.prank(stranger);
        ms.resolveRuling(1, buyerA, 1, 100);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotResolver.selector, stranger));
        vm.prank(stranger);
        ms.onDisputeOpened(1, buyerA, 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoOpenDispute.selector, 1, buyerA));
        vm.prank(address(resolver));
        ms.resolveRuling(1, buyerA, 1, 100);
    }

    function test_RevertWhen_badConstructorParams() public {
        MarketSettlement.Params memory p = MarketSettlement.Params(100, 5000, 9000, 1000, 3, 60, 300);
        p.feeBps = 10_001;
        vm.expectRevert(MarketSettlement.BadParams.selector);
        new MarketSettlement(op, factory, trigger, address(0), treasury, p);
        p = MarketSettlement.Params(100, 5000, 9000, 1000, 3, 300, 300); // report window must exceed contest
        vm.expectRevert(MarketSettlement.BadParams.selector);
        new MarketSettlement(op, factory, trigger, address(0), treasury, p);
        p = MarketSettlement.Params(100, 5000, 9000, 1000, 3, 60, 300);
        vm.expectRevert(MarketSettlement.ZeroAddress.selector);
        new MarketSettlement(op, factory, trigger, address(0), address(0), p);
    }

    function test_sizesUnderEip170() public view {
        assertLe(address(ms).code.length, 24_576);
        assertLe(address(trigger).code.length, 24_576);
    }

    // ================================================================== fuzz: payout invariant

    /// sellerPaid + fee + held == raised, for any bid amounts, prices and tier.
    function testFuzz_payoutInvariant(uint256 amtA, uint256 amtB, uint256 pA, uint256 pB, uint8 tier) public {
        amtA = bound(amtA, 1e6, 6000e6);
        amtB = bound(amtB, 1e6, 6000e6);
        pA = bound(pA, 7_600_000, 20_000_000);
        pB = bound(pB, 7_600_000, 20_000_000);
        tier = uint8(bound(tier, 0, 2));
        LotFactory.LotSpec memory spec = _bigCod();
        if (tier == 1) {
            vm.prank(op);
            ms.markProven(ingrid, true);
        } else if (tier == 2) {
            spec.sector = Keys.TRUCK;
            spec.seller = lars;
        }
        address seller = spec.seller;
        uint256 sellerBefore = _bal(address(teur), seller);
        address[] memory who = new address[](2);
        uint256[] memory maxP = new uint256[](2);
        uint256[] memory amt = new uint256[](2);
        (who[0], who[1], maxP[0], maxP[1], amt[0], amt[1]) = (buyerA, buyerB, pA, pB, amtA, amtB);
        (uint256 lotId,,) = _sell(spec, who, maxP, amt);
        uint256 raised = _auctionOf(lotId).currencyRaised();
        (uint256 held,,,) = ms.heldOf(lotId);
        uint256 sellerPaid = _bal(address(teur), seller) - sellerBefore;
        uint256 fee = _bal(address(teur), treasury);
        assertEq(sellerPaid + fee + held, raised, "sellerPaid + fee + held == raised");
        assertEq(_bal(address(teur), address(ms)), held, "settlement holds only open held money");
        assertEq(fee, raised * FEE_BPS / 10_000);
    }

    // ================================================================== fuzz: nothing stuck

    /// Three buyers, each randomly: hand over all, hand over part, report a no-show, or stay silent. After every
    /// window passes and the keeper's actions run, no currency is left in settlement, and
    /// seller + buyers' refunds + treasury == raised.
    function testFuzz_noCurrencyStuckAfterAllWindows(uint8 a0, uint8 a1, uint8 a2, uint96 x0, uint96 x1, uint96 x2)
        public
    {
        uint8[3] memory act = [a0 % 4, a1 % 4, a2 % 4];
        address[] memory who = new address[](3);
        uint256[] memory maxP = new uint256[](3);
        uint256[] memory amt = new uint256[](3);
        (who[0], who[1], who[2]) = (buyerA, buyerB, buyerC);
        (maxP[0], maxP[1], maxP[2]) = (9_000_000, 12_000_000, 15_000_000);
        (amt[0], amt[1], amt[2]) = (bound(x0, 10e6, 3000e6), bound(x1, 10e6, 3000e6), bound(x2, 10e6, 3000e6));
        uint256 sellerBefore = _bal(address(teur), ingrid);
        uint256[3] memory buyerBefore;
        for (uint256 i; i < 3; i++) {
            buyerBefore[i] = _bal(address(teur), who[i]);
        }
        (uint256 lotId, uint256[] memory tokens, uint256[] memory refunds) = _sell(_cod(address(teur)), who, maxP, amt);
        uint256 raised = _auctionOf(lotId).currencyRaised();

        for (uint256 i; i < 3; i++) {
            if (tokens[i] == 0) continue;
            if (act[i] == 0) _handover(lotId, who[i], tokens[i], who[i], ingridKey);
            if (act[i] == 1) _handover(lotId, who[i], tokens[i] / 2 + 1, who[i], ingridKey);
        }
        uint64 deadline = ms.saleOf(lotId).pickupDeadline;
        vm.roll(deadline + 1);
        for (uint256 i; i < 3; i++) {
            if (tokens[i] == 0 || act[i] != 2) continue;
            vm.prank(who[i]);
            ms.reportNoShow(lotId, tokens[i]);
        }
        vm.roll(deadline + CONTEST + 2);
        for (uint256 i; i < 3; i++) {
            (bool open,,,,) = ms.reportOf(lotId, who[i]);
            if (open) ms.finalizeNoShow(lotId, who[i]);
        }
        vm.roll(deadline + REPORT + 1);
        if (!ms.saleOf(lotId).complete) ms.releaseExpired(lotId);

        assertEq(_bal(address(teur), address(ms)), 0, "no currency stuck");
        assertTrue(ms.saleOf(lotId).complete, "every lot state ends");
        uint256 buyerRefunds;
        for (uint256 i; i < 3; i++) {
            // currency spent in the auction minus what came back from the auction and from no-show refunds
            uint256 spent = buyerBefore[i] - _bal(address(teur), who[i]);
            buyerRefunds += amt[i] - refunds[i] - spent;
        }
        uint256 sellerGot = _bal(address(teur), ingrid) - sellerBefore;
        assertEq(
            sellerGot + buyerRefunds + _bal(address(teur), treasury), raised, "seller + buyers + treasury == raised"
        );
    }

    // ================================================================== helpers

    function _auctionOf(uint256 lotId) internal view returns (IAuction) {
        return IAuction(factory.getLot(lotId).auction);
    }

    function _claimAll(uint256 lotId, address who) internal returns (uint256) {
        IAuction a = _auctionOf(lotId);
        a.checkpoint();
        a.exitBid(0);
        a.claimTokens(0);
        return _bal(factory.getLot(lotId).token, who);
    }
}

import {
    IContinuousClearingAuction as IAuction
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
