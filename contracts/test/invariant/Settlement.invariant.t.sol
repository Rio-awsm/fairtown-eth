// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SettlementFixture} from "../utils/SettlementFixture.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {MarketSettlement} from "../../src/MarketSettlement.sol";
import {DisputeResolver} from "../../src/oracles/DisputeResolver.sol";
import {MockStable} from "../../src/tokens/MockStable.sol";

interface IBal {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// Random actions on settled lots, in any order: handovers, no-show reports, contests, finalizes, quality disputes,
/// rulings, expiries, releases and time passing. Every call that reverts is simply skipped; the invariants must hold
/// whatever happened.
contract SettlementHandler is Test {
    MarketSettlement internal ms;
    DisputeResolver internal resolver;
    address internal forwarder;
    address internal seller;
    uint256 internal sellerKey;
    uint256[] internal lots;
    address[] internal buyers;
    uint256[] public disputes;
    mapping(bytes32 => uint256) public calls;

    constructor(
        MarketSettlement ms_,
        DisputeResolver resolver_,
        address forwarder_,
        address seller_,
        uint256 sellerKey_,
        uint256[] memory lots_,
        address[] memory buyers_
    ) {
        ms = ms_;
        resolver = resolver_;
        forwarder = forwarder_;
        seller = seller_;
        sellerKey = sellerKey_;
        lots = lots_;
        buyers = buyers_;
    }

    function _lot(uint256 seed) internal view returns (uint256) {
        return lots[seed % lots.length];
    }

    function _buyer(uint256 seed) internal view returns (address) {
        return buyers[seed % buyers.length];
    }

    function _part(uint256 lotId, address who, uint256 bps) internal view returns (uint256) {
        uint256 bal = IBal(ms.saleOf(lotId).token).balanceOf(who);
        return bal * bound(bps, 1, 10_000) / 10_000;
    }

    function handover(uint256 l, uint256 b, uint256 bps) external {
        uint256 lotId = _lot(l);
        address who = _buyer(b);
        uint256 amount = _part(lotId, who, bps);
        uint64 expiry = uint64(block.number + 100);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerKey, ms.handoverDigest(lotId, who, amount, expiry));
        vm.prank(who);
        try ms.confirmHandover(lotId, who, amount, expiry, abi.encodePacked(r, s, v)) {
            calls["handover"]++;
        } catch {}
    }

    function reportNoShow(uint256 l, uint256 b, uint256 bps) external {
        uint256 lotId = _lot(l);
        address who = _buyer(b);
        uint256 amount = _part(lotId, who, bps);
        vm.prank(who);
        try ms.reportNoShow(lotId, amount) {
            calls["report"]++;
        } catch {}
    }

    function contest(uint256 l, uint256 b) external {
        vm.prank(seller);
        try ms.contestNoShow(_lot(l), _buyer(b), keccak256("handover photo"), "ipfs://evidence") {
            disputes.push(resolver.disputeCount());
            calls["contest"]++;
        } catch {}
    }

    function finalize(uint256 l, uint256 b) external {
        try ms.finalizeNoShow(_lot(l), _buyer(b)) {
            calls["finalize"]++;
        } catch {}
    }

    function openQuality(uint256 l, uint256 b, uint256 bps) external {
        uint256 lotId = _lot(l);
        address who = _buyer(b);
        uint256 amount = _part(lotId, who, bps);
        vm.prank(who);
        try resolver.openDispute(lotId, amount, keccak256("photos"), "ipfs://photos") {
            disputes.push(resolver.disputeCount());
            calls["quality"]++;
        } catch {}
    }

    function rule(uint256 d, uint16 bps) external {
        if (disputes.length == 0) return;
        uint256 id = disputes[d % disputes.length];
        uint16 refund = uint16(bound(bps, 0, 10_000));
        vm.prank(forwarder);
        try resolver.onReport("", abi.encode(id, refund, keccak256("reason"))) {
            calls["rule"]++;
        } catch {}
    }

    function expire(uint256 d) external {
        if (disputes.length == 0) return;
        try resolver.expireDispute(disputes[d % disputes.length]) {
            calls["expire"]++;
        } catch {}
    }

    function release(uint256 l) external {
        try ms.releaseExpired(_lot(l)) {
            calls["release"]++;
        } catch {}
    }

    function passTime(uint256 blocks) external {
        vm.roll(block.number + bound(blocks, 1, 400));
    }

    function disputeCount() external view returns (uint256) {
        return disputes.length;
    }
}

/// S1 5.1 invariants on real CCA lots: held money matches the settlement balance, lot tokens are conserved, and after
/// every window and timeout no currency is stuck and seller + buyers + treasury == raised.
/// forge-config: default.invariant.runs = 48
/// forge-config: default.invariant.depth = 40
/// forge-config: default.invariant.fail-on-revert = false
contract SettlementInvariantTest is SettlementFixture {
    SettlementHandler internal handler;
    uint256[] internal lotIds;
    address[] internal who;
    uint256 internal moneyBefore;

    function setUp() public {
        vm.roll(100);
        _etchPermit2();
        _deploy(DEFAULT_SHARE_BPS);
        who = [buyerA, buyerB, buyerC];
        moneyBefore = _money();
        uint256[] memory maxP = new uint256[](3);
        uint256[] memory amt = new uint256[](3);
        (maxP[0], maxP[1], maxP[2]) = (15_000_000, 12_000_000, 9_000_000);
        (amt[0], amt[1], amt[2]) = (700e6, 500e6, 300e6);
        for (uint256 i; i < 3; i++) {
            LotFactory.LotSpec memory s = _cod(address(teur));
            s.qty = 1000;
            (uint256 lot,,) = _sell(s, who, maxP, amt);
            lotIds.push(lot);
        }
        handler = new SettlementHandler(ms, resolver, creForwarder, ingrid, ingridKey, lotIds, who);
        targetContract(address(handler));
    }

    function _money() internal view returns (uint256 m) {
        m = _bal(address(teur), ingrid) + _bal(address(teur), treasury);
        for (uint256 i; i < who.length; i++) {
            m += _bal(address(teur), who[i]);
        }
    }

    /// Held sums match balance: the settlement holds exactly the sum of every lot's held money, nothing else.
    function invariant_heldMatchesBalance() public view {
        uint256 held;
        for (uint256 i; i < lotIds.length; i++) {
            held += ms.saleOf(lotIds[i]).heldRemaining;
        }
        assertEq(_bal(address(teur), address(ms)), held);
    }

    /// Tokens conserved: every lot token is with a buyer, the settlement, the resolver or its auction (dust); burns
    /// reduce the supply by the same amount.
    function invariant_tokensConserved() public view {
        for (uint256 i; i < lotIds.length; i++) {
            MarketSettlement.Sale memory s = ms.saleOf(lotIds[i]);
            IBal t = IBal(s.token);
            uint256 sum = t.balanceOf(address(ms)) + t.balanceOf(address(resolver))
                + t.balanceOf(factory.getLot(lotIds[i]).auction);
            for (uint256 j; j < who.length; j++) {
                sum += t.balanceOf(who[j]);
            }
            assertEq(t.totalSupply(), sum);
        }
    }

    /// Bookkeeping stays sane: escrowed tokens never exceed what is outstanding, and a completed lot holds nothing.
    function invariant_accountingSane() public view {
        for (uint256 i; i < lotIds.length; i++) {
            MarketSettlement.Sale memory s = ms.saleOf(lotIds[i]);
            assertLe(s.reportedTokens, s.outstanding);
            if (s.complete) assertEq(s.heldRemaining, 0);
        }
    }

    /// The handler is not vacuous: a fixed path through it reaches every kind of state change.
    function test_handlerReachesRealStates() public {
        handler.openQuality(0, 0, 5000); // dispute 1: buyer A, lot 0, half its tokens
        handler.openQuality(2, 0, 5000); // dispute 2: buyer A, lot 2, left without a ruling
        handler.rule(0, 4000); // dispute 1 ruled
        handler.handover(1, 1, 10_000); // buyer B hands over all of lot 1
        handler.passTime(400); // past the 300-block pickup window and dispute 2's ruling timeout
        handler.expire(1); // dispute 2 expires: seller paid, no refund
        handler.reportNoShow(2, 2, 10_000); // buyer C, lot 2
        handler.contest(2, 2); // dispute 3
        handler.rule(2, 10_000); // upheld no-show
        handler.reportNoShow(0, 1, 10_000); // buyer B, lot 0
        handler.passTime(100); // past the 60-block contest window
        handler.finalize(0, 1);
        handler.passTime(400); // past the report window
        handler.release(0);
        bytes32[9] memory names =
            [bytes32("handover"), "report", "contest", "finalize", "quality", "rule", "expire", "release", "rule"];
        for (uint256 i; i < names.length; i++) {
            assertGt(handler.calls(names[i]), 0, string(abi.encodePacked(names[i])));
        }
        invariant_heldMatchesBalance();
        invariant_tokensConserved();
        invariant_accountingSane();
        afterInvariant();
    }

    /// No currency stuck after all windows: end every open case the way the keeper would, then nothing is held and
    /// every unit of currency is back with the seller, the buyers or the treasury (or still in an auction as dust).
    function afterInvariant() public {
        vm.roll(block.number + 20_000); // past every pickup, report and contest window and the ruling timeout
        for (uint256 i; i < handler.disputeCount(); i++) {
            try resolver.expireDispute(handler.disputes(i)) {} catch {}
        }
        for (uint256 i; i < lotIds.length; i++) {
            for (uint256 j; j < who.length; j++) {
                try ms.finalizeNoShow(lotIds[i], who[j]) {} catch {}
            }
            try ms.releaseExpired(lotIds[i]) {} catch {}
        }
        assertEq(_bal(address(teur), address(ms)), 0, "no currency stuck in settlement");
        uint256 dust;
        for (uint256 i; i < lotIds.length; i++) {
            dust += _bal(address(teur), factory.getLot(lotIds[i]).auction);
        }
        assertEq(_money() + dust, moneyBefore, "seller + buyers + treasury == raised");
        for (uint256 i; i < lotIds.length; i++) {
            assertTrue(ms.saleOf(lotIds[i]).complete, "every lot resolved");
        }
    }
}
