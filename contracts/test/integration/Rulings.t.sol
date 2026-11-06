// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SettlementFixture} from "../utils/SettlementFixture.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {MarketSettlement} from "../../src/MarketSettlement.sol";
import {ReceiverBase} from "../../src/oracles/ReceiverBase.sol";
import {DisputeResolver, ISettlementRulings} from "../../src/oracles/DisputeResolver.sol";

/// S1 4.1: DisputeResolver (contract 7.8) and MarketSettlement.resolveRuling (7.5). Quality disputes, contested
/// no-shows, the ruling timeout (D-65), upheld means any refund (D-66), and the extended money invariant.
contract RulingsTest is SettlementFixture {
    event DisputeOpened(
        uint256 indexed disputeId,
        uint256 indexed lotId,
        address indexed buyer,
        uint8 kind,
        uint256 tokenAmount,
        bytes32 evidenceHash,
        string evidenceURI
    );
    event DisputeResolved(uint256 indexed disputeId, uint256 indexed lotId, uint16 refundBps, bytes32 reasonHash);
    event DisputeExpired(uint256 indexed disputeId, uint256 indexed lotId);
    event RulingSettled(uint256 indexed lotId, address indexed buyer, uint256 refundToBuyer, uint256 paidToSeller);

    uint8 constant PICKED_UP = 4;
    uint8 constant PAID_IN_FULL = 5;
    uint8 constant DISPUTED = 8;
    uint8 constant REFUNDED = 9;
    bytes32 constant REASON = keccak256("rubric: gills brown, grade B not E");

    function setUp() public {
        vm.roll(100);
        _etchPermit2();
        _deploy(DEFAULT_SHARE_BPS);
    }

    // ================================================================== quality disputes

    /// Guide 4.1: 40% refund exact. EUR 1,000 raised, new seller: fee 10, advance 495, held 495.
    function test_quality_40pctRefundExact() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        address token = factory.getLot(lot).token;
        uint256 a0 = _bal(address(teur), buyerA);
        uint256 i0 = _bal(address(teur), ingrid);

        vm.expectEmit(address(resolver));
        emit DisputeOpened(1, lot, buyerA, 0, tok, keccak256("photos"), "ipfs://photos");
        uint256 id = _openQuality(lot, buyerA, tok);
        assertEq(_bal(token, buyerA), 0);
        assertEq(_bal(token, address(resolver)), tok, "tokens escrowed in the resolver");
        assertEq(ms.disputedTokensOf(lot, buyerA), tok);
        assertEq(ms.statusOf(lot), DISPUTED);

        vm.expectEmit(address(resolver));
        emit DisputeResolved(id, lot, 4000, REASON);
        vm.expectEmit(address(ms));
        emit RulingSettled(lot, buyerA, 198_000_000, 297_000_000);
        _rule(id, 4000);

        assertEq(_bal(address(teur), buyerA) - a0, 198_000_000, "40% of 495");
        assertEq(_bal(address(teur), ingrid) - i0, 297_000_000, "the rest to the seller");
        assertEq(_bal(token, address(resolver)), 0, "tokens burned");
        assertEq(_bal(address(teur), address(ms)), 0);
        assertEq(ms.disputedTokensOf(lot, buyerA), 0);
        assertEq(ms.statusOf(lot), REFUNDED);
        MarketSettlement.Sale memory s = ms.saleOf(lot);
        assertTrue(s.complete);
        assertFalse(s.paidInFull, "a refunded lot is not paid in full (D-44)");
        (uint32 clean, uint32 noShows,) = ms.sellerRecord(ingrid);
        assertEq(clean, 0, "not a clean lot");
        assertEq(noShows, 0, "a quality refund does not mark the seller");
    }

    /// Key rule: a dispute opened in time is honoured after the window; disputed money is excluded from release.
    function test_quality_heldBackFromRelease_rulingAfterWindowHonoured() public {
        (uint256 lot, uint256[] memory tok) = _sellTwo(500e6, 500e6);
        _openQuality(lot, buyerA, tok[0]);
        uint256 held0 = ms.saleOf(lot).heldRemaining;
        uint256 outstanding = ms.saleOf(lot).outstanding;

        uint64 reportEnds = ms.saleOf(lot).pickupDeadline + REPORT;
        vm.roll(reportEnds + 1);
        uint256 i0 = _bal(address(teur), ingrid);
        ms.releaseExpired(lot); // B was silent: B's share goes to the seller, A's stays held
        uint256 releasedB = held0 * (outstanding - tok[0]) / outstanding;
        assertEq(_bal(address(teur), ingrid) - i0, releasedB);
        assertEq(ms.saleOf(lot).heldRemaining, held0 - releasedB, "A's share still held");
        assertEq(ms.statusOf(lot), DISPUTED);

        // Too late for B to open one now.
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.HeldAlreadyReleased.selector, lot));
        vm.prank(buyerB);
        resolver.openDispute(lot, 1, bytes32(0), "");

        uint256 a0 = _bal(address(teur), buyerA);
        _rule(1, 10_000);
        assertEq(_bal(address(teur), buyerA) - a0, held0 - releasedB, "full refund of A's share after the window");
        assertEq(_bal(address(teur), address(ms)), 0);
        assertTrue(ms.saleOf(lot).complete);
    }

    function test_RevertWhen_qualityDisputeRules() public {
        (uint256 open,) = _list(_lot());
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NotSold.selector, open));
        vm.prank(buyerA);
        resolver.openDispute(open, 1, bytes32(0), "");

        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        uint256 sold = ms.saleOf(lot).soldTokens;
        vm.startPrank(buyerA);
        vm.expectRevert(MarketSettlement.ZeroAmount.selector);
        resolver.openDispute(lot, 0, bytes32(0), "");
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.AmountTooHigh.selector, sold + 1, sold));
        resolver.openDispute(lot, sold + 1, bytes32(0), "");
        vm.stopPrank();
        // A non-holder cannot dispute: the escrow pull fails.
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, 1));
        vm.prank(stranger);
        resolver.openDispute(lot, 1, bytes32(0), "");

        _openQuality(lot, buyerA, tok / 2);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.DisputeOpen.selector, lot, buyerA));
        vm.prank(buyerA);
        resolver.openDispute(lot, 1, bytes32(0), "");
        // While disputed, the same buyer cannot also report a no-show.
        vm.roll(ms.saleOf(lot).pickupDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.DisputeOpen.selector, lot, buyerA));
        vm.prank(buyerA);
        ms.reportNoShow(lot, 1);

        // An open no-show report blocks a quality dispute by that buyer.
        (uint256 lot2, uint256 tok2) = _sellTo(_lot(), buyerB, 1000e6);
        vm.roll(ms.saleOf(lot2).pickupDeadline + 1);
        vm.prank(buyerB);
        ms.reportNoShow(lot2, tok2 / 2);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.NoShowOpen.selector, lot2, buyerB));
        vm.prank(buyerB);
        resolver.openDispute(lot2, 1, bytes32(0), "");

        // After pickup deadline + report window, no new disputes.
        (uint256 lot3,) = _sellTo(_lot(), buyerC, 1000e6);
        uint64 reportEnds = ms.saleOf(lot3).pickupDeadline + REPORT;
        vm.roll(reportEnds + 1);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.WindowClosed.selector, reportEnds));
        vm.prank(buyerC);
        resolver.openDispute(lot3, 1, bytes32(0), "");
    }

    function test_RevertWhen_disputeAfterHandover() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        _handover(lot, buyerA, tok, buyerA, ingridKey);
        vm.expectRevert(abi.encodeWithSelector(MarketSettlement.HeldAlreadyReleased.selector, lot));
        vm.prank(buyerA);
        resolver.openDispute(lot, 1, bytes32(0), "");
    }

    // ================================================================== no-show rulings

    /// Guide 4.1: upheld no-show, 100% refund, record reset (proven seller, 90% advance: held 99).
    function test_noShow_upheld100_recordReset() public {
        vm.prank(op);
        ms.markProven(ingrid, true);
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        (uint256 held,,,) = ms.heldOf(lot);
        assertEq(held, 99_000_000);
        uint256 id = _contested(lot, buyerA, tok);
        assertEq(resolver.disputeOf(id).kind, 1, "no_show");

        uint256 a0 = _bal(address(teur), buyerA);
        vm.expectEmit(address(ms));
        emit RulingSettled(lot, buyerA, 99_000_000, 0);
        _rule(id, 10_000);
        assertEq(_bal(address(teur), buyerA) - a0, 99_000_000);
        (uint32 clean, uint32 noShows, bool proven) = ms.sellerRecord(ingrid);
        assertEq(noShows, 1);
        assertEq(clean, 0);
        assertFalse(proven, "proven flag cleared");
        assertEq(ms.statusOf(lot), REFUNDED);
        (bool open,,,,) = ms.reportOf(lot, buyerA);
        assertFalse(open);
        // Only the unsold supply (swept at settle, awaiting relist or reclaim) is left; the escrow was burned.
        assertEq(_bal(factory.getLot(lot).token, address(ms)), ms.saleOf(lot).unsold, "escrowed tokens burned");
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    /// D-66: any refund on a no-show ruling marks the seller.
    function test_noShow_partialRefundStillMarksSeller() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        uint256 id = _contested(lot, buyerA, tok);
        uint256 i0 = _bal(address(teur), ingrid);
        vm.expectEmit(address(ms));
        emit RulingSettled(lot, buyerA, 148_500_000, 346_500_000); // 30% of 495
        _rule(id, 3000);
        assertEq(_bal(address(teur), ingrid) - i0, 346_500_000);
        (, uint32 noShows,) = ms.sellerRecord(ingrid);
        assertEq(noShows, 1);
    }

    /// Guide 4.1: a rejected no-show pays the seller and keeps the record clean.
    function test_noShow_rejected_paysSeller() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        uint256 id = _contested(lot, buyerA, tok);
        uint256 i0 = _bal(address(teur), ingrid);
        uint256 a0 = _bal(address(teur), buyerA);
        vm.expectEmit(address(ms));
        emit RulingSettled(lot, buyerA, 0, 495_000_000);
        _rule(id, 0);
        assertEq(_bal(address(teur), ingrid) - i0, 495_000_000);
        assertEq(_bal(address(teur), buyerA), a0);
        (uint32 clean, uint32 noShows,) = ms.sellerRecord(ingrid);
        assertEq(noShows, 0);
        assertEq(clean, 1, "a clean lot");
        assertEq(ms.statusOf(lot), PAID_IN_FULL);
    }

    // ================================================================== resolution rules

    /// Guide 4.1: double resolution reverts; so do unknown ids, bad bps and non-forwarders.
    function test_RevertWhen_doubleOrBadResolution() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        uint256 id = _openQuality(lot, buyerA, tok);

        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.NotForwarder.selector, stranger));
        vm.prank(stranger);
        resolver.onReport("", abi.encode(id, uint16(0), REASON));
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.BadRefundBps.selector, 10_001));
        _rule(id, 10_001);
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.DisputeNotOpen.selector, 99));
        _rule(99, 0);

        _rule(id, 2500);
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.DisputeNotOpen.selector, id));
        _rule(id, 2500);
        vm.roll(vm.getBlockNumber() + RULING_TIMEOUT + 1);
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.DisputeNotOpen.selector, id));
        resolver.expireDispute(id);
    }

    function test_RevertWhen_resolverEntryPointsMisused() public {
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.NotSettlement.selector, stranger));
        vm.prank(stranger);
        resolver.openNoShowRuling(1, buyerA, 1, bytes32(0), "");
        // Read the settlement first: an external call inside the arguments would consume expectRevert.
        DisputeResolver.Dispute memory none = resolver.disputeOf(1);
        assertFalse(none.open);
        address stl = address(resolver.settlement());
        vm.expectRevert(DisputeResolver.ZeroTimeout.selector);
        new DisputeResolver(op, creForwarder, ISettlementRulings(stl), factory, 0);
        vm.expectRevert(ReceiverBase.ZeroAddress.selector);
        new DisputeResolver(op, creForwarder, ISettlementRulings(stl), LotFactory(address(0)), 1);
        vm.expectRevert(ReceiverBase.ZeroAddress.selector);
        new DisputeResolver(op, creForwarder, ISettlementRulings(address(0)), factory, 1);
    }

    // ================================================================== timeout (D-65)

    function test_timeout_qualityExpires_sellerPaidNoRefund() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        uint256 id = _openQuality(lot, buyerA, tok);
        uint64 deadline = resolver.disputeOf(id).openedBlock + RULING_TIMEOUT;
        vm.roll(deadline);
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.TooEarly.selector, deadline));
        resolver.expireDispute(id);

        vm.roll(deadline + 1);
        uint256 i0 = _bal(address(teur), ingrid);
        uint256 a0 = _bal(address(teur), buyerA);
        vm.expectEmit(address(resolver));
        emit DisputeExpired(id, lot);
        vm.prank(stranger); // anyone
        resolver.expireDispute(id);
        assertEq(_bal(address(teur), ingrid) - i0, 495_000_000);
        assertEq(_bal(address(teur), buyerA), a0, "never a default refund");
        assertEq(ms.statusOf(lot), PAID_IN_FULL);
        assertEq(_bal(address(teur), address(ms)), 0);
        // A late ruling is stale.
        vm.expectRevert(abi.encodeWithSelector(DisputeResolver.DisputeNotOpen.selector, id));
        _rule(id, 10_000);
    }

    function test_timeout_contestedNoShowExpires_recordKept() public {
        (uint256 lot, uint256 tok) = _sellTo(_lot(), buyerA, 1000e6);
        uint256 id = _contested(lot, buyerA, tok);
        vm.roll(resolver.disputeOf(id).openedBlock + RULING_TIMEOUT + 1);
        uint256 i0 = _bal(address(teur), ingrid);
        resolver.expireDispute(id);
        assertEq(_bal(address(teur), ingrid) - i0, 495_000_000);
        (uint32 clean, uint32 noShows,) = ms.sellerRecord(ingrid);
        assertEq(noShows, 0);
        assertEq(clean, 1);
        (bool open,,,,) = ms.reportOf(lot, buyerA);
        assertFalse(open);
        assertEq(ms.statusOf(lot), PAID_IN_FULL);
    }

    function test_rejectedNoShow_withEarlierRefund_staysRefunded() public {
        (uint256 lot, uint256[] memory tok) = _sellTwo(500e6, 500e6);
        uint256 qa = _openQuality(lot, buyerA, tok[0]);
        _rule(qa, 5000);
        uint256 nb = _contested(lot, buyerB, tok[1]);
        _rule(nb, 0);
        assertEq(ms.statusOf(lot), REFUNDED, "A's refund keeps the lot refunded");
        assertEq(_bal(address(teur), address(ms)), 0);
    }

    // ================================================================== extended invariant

    /// seller + buyers + treasury == raised, nothing stuck in settlement or the resolver, whatever mix of quality
    /// rulings, no-show rulings, timeouts, handovers and silence.
    function testFuzz_rulingsKeepMoneyWhole(uint96 xa, uint96 xb, uint16 bpsA, uint16 bpsB, uint8 pathB, bool expireA)
        public
    {
        uint256 amtA = bound(xa, 10e6, 2000e6);
        uint256 amtB = bound(xb, 10e6, 2000e6);
        bpsA = uint16(bound(bpsA, 0, 10_000));
        bpsB = uint16(bound(bpsB, 0, 10_000));
        pathB = uint8(bound(pathB, 0, 3));
        uint256 before = _bal(address(teur), buyerA) + _bal(address(teur), buyerB) + _bal(address(teur), ingrid)
            + _bal(address(teur), treasury);

        (uint256 lot, uint256[] memory tok) = _sellTwo(amtA, amtB);
        uint256 qa = _openQuality(lot, buyerA, tok[0]);
        uint64 deadline = ms.saleOf(lot).pickupDeadline;

        if (pathB == 0) {
            _handover(lot, buyerB, tok[1], buyerB, ingridKey);
        } else if (pathB == 2) {
            uint256 nb = _contested(lot, buyerB, tok[1]);
            _rule(nb, bpsB);
        } else if (pathB == 3) {
            vm.roll(deadline + 1);
            vm.prank(buyerB);
            ms.reportNoShow(lot, tok[1]);
            vm.roll(vm.getBlockNumber() + CONTEST + 1);
            ms.finalizeNoShow(lot, buyerB);
        } // pathB == 1: silent

        if (expireA) {
            uint256 at = resolver.disputeOf(qa).openedBlock + RULING_TIMEOUT + 1;
            if (vm.getBlockNumber() < at) vm.roll(at);
            resolver.expireDispute(qa);
        } else {
            _rule(qa, bpsA);
        }
        MarketSettlement.Sale memory s = ms.saleOf(lot);
        if (!s.complete && !s.released) {
            if (vm.getBlockNumber() <= deadline + REPORT) vm.roll(deadline + REPORT + 1);
            ms.releaseExpired(lot);
        }

        address auction = factory.getLot(lot).auction;
        uint256 afterSum = _bal(address(teur), buyerA) + _bal(address(teur), buyerB) + _bal(address(teur), ingrid)
            + _bal(address(teur), treasury);
        assertEq(_bal(address(teur), address(ms)), 0, "nothing stuck in settlement");
        assertEq(afterSum + _bal(address(teur), auction), before, "seller + buyers + treasury == raised");
        assertLe(_bal(address(teur), auction), 2, "CCA dust only");
        assertEq(_bal(factory.getLot(lot).token, address(resolver)), 0, "no tokens left in the resolver");
        assertTrue(ms.saleOf(lot).complete, "every held unit resolved");
    }

    // ================================================================== helpers

    function _lot() internal view returns (LotFactory.LotSpec memory s) {
        s = _cod(address(teur));
        s.qty = 1000; // EUR 1,000 at 7.50 fills at the floor: exact numbers
    }

    function _sellTwo(uint256 a, uint256 b) internal returns (uint256 lot, uint256[] memory tok) {
        address[] memory who = new address[](2);
        uint256[] memory maxP = new uint256[](2);
        uint256[] memory amt = new uint256[](2);
        (who[0], who[1]) = (buyerA, buyerB);
        (maxP[0], maxP[1]) = (15_000_000, 15_000_000);
        (amt[0], amt[1]) = (a, b);
        (lot, tok,) = _sell(_lot(), who, maxP, amt);
    }

    function _openQuality(uint256 lot, address buyer, uint256 tokens) internal returns (uint256) {
        vm.prank(buyer);
        resolver.openDispute(lot, tokens, keccak256("photos"), "ipfs://photos");
        return resolver.disputeCount();
    }

    function _contested(uint256 lot, address buyer, uint256 tokens) internal returns (uint256 id) {
        uint64 after_ = ms.saleOf(lot).pickupDeadline + 1;
        if (vm.getBlockNumber() < after_) vm.roll(after_);
        vm.prank(buyer);
        ms.reportNoShow(lot, tokens);
        vm.prank(ingrid);
        ms.contestNoShow(lot, buyer, keccak256("handover photo"), "ipfs://evidence");
        (,,,, id) = ms.reportOf(lot, buyer);
    }

    function _rule(uint256 id, uint16 bps) internal {
        vm.prank(creForwarder);
        resolver.onReport("", abi.encode(id, bps, REASON));
    }
}
