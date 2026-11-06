// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/console.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {ValidationHookLib} from "continuous-clearing-auction/libraries/ValidationHookLib.sol";
import {LotFixture, IERC20Like} from "../utils/LotFixture.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {LotToken} from "../../src/tokens/LotToken.sol";
import {MockStable} from "../../src/tokens/MockStable.sol";
import {AgentRegistryHook} from "../../src/registry/AgentRegistryHook.sol";
import {PriceMath} from "../../src/libraries/PriceMath.sol";
import {Keys} from "../../src/libraries/Keys.sol";

interface ICcaErrors {
    error BidMustBeAboveClearingPrice();
    error AuctionIsOver();
    error AuctionNotStarted();
}

contract LotFactoryTest is LotFixture {
    event LotListed(
        uint256 indexed lotId,
        address indexed seller,
        bytes32 indexed market,
        address auction,
        address token,
        address currency,
        bytes32 sector,
        bytes32 commodity,
        bytes32 place,
        uint256 qty,
        uint256 floorPerUnit,
        uint64 startBlock,
        uint64 endBlock,
        uint256 parentLotId,
        string metadataURI
    );

    function setUp() public {
        vm.roll(100);
        _etchPermit2();
        _deploy(DEFAULT_SHARE_BPS);
    }

    // ------------------------------------------------------------------ creation

    function test_createLot_cod600kgEUR() public {
        LotFactory.LotSpec memory spec = _cod(address(teur));
        uint64 start = uint64(block.number + 1);
        vm.expectEmit(true, true, true, false, address(factory));
        emit LotListed(
            1,
            ingrid,
            "fish_dock",
            address(0),
            address(0),
            address(teur),
            Keys.FISH,
            "cod",
            "bergen",
            600,
            7_500_000,
            start,
            start + 45,
            0,
            "ipfs://cod-600"
        );
        (uint256 lotId, IContinuousClearingAuction a) = _list(spec);

        LotFactory.Lot memory lot = factory.getLot(lotId);
        assertEq(lotId, 1);
        assertEq(factory.lotCount(), 1);
        assertEq(lot.auction, address(a));
        assertEq(lot.startBlock, start);
        assertEq(lot.endBlock, start + 45);
        assertEq(lot.status, 0);
        assertEq(lot.spec.metadataURI, "ipfs://cod-600");

        // Auction parameters, read back from CCA itself.
        uint256 tick = PriceMath.tickFor(PriceMath.toQ96(7_500_000));
        assertEq(a.currency(), address(teur));
        assertEq(a.token(), lot.token);
        assertEq(a.totalSupply(), 600e18);
        assertEq(a.tokensRecipient(), settlement, "settlement is both recipients");
        assertEq(a.fundsRecipient(), settlement, "settlement is both recipients");
        assertEq(a.startBlock(), start);
        assertEq(a.endBlock(), start + 45);
        assertEq(a.claimBlock(), start + 45);
        assertEq(address(a.validationHook()), address(hook));
        assertEq(a.floorPrice(), PriceMath.floorToTick(PriceMath.toQ96(7_500_000), tick));
        assertEq(a.tickSpacing(), tick);
        assertEq(lot.floorQ96, a.floorPrice());

        // Funded and activated in the same tx: the auction holds the whole supply, the factory none.
        LotToken t = LotToken(lot.token);
        assertEq(t.name(), "Lot 1 Cod");
        assertEq(t.symbol(), "LOT1");
        assertEq(t.balanceOf(address(a)), 600e18);
        assertEq(t.balanceOf(address(factory)), 0);
        assertEq(t.settlement(), settlement);
    }

    function test_labelUnderscoreToSpace() public {
        LotFactory.LotSpec memory spec = _cod(address(teur));
        spec.commodity = "truck_capacity";
        spec.sector = Keys.TRUCK;
        spec.seller = _registered("lars.truck", reg.TRUCK());
        (uint256 lotId,) = _list(spec);
        assertEq(LotToken(factory.getLot(lotId).token).name(), "Lot 1 Truck capacity");
    }

    function test_operatorListsForSeller() public {
        LotFactory.LotSpec memory spec = _cod(address(teur));
        vm.prank(op);
        (uint256 lotId,,) = factory.createLot(spec);
        assertEq(factory.getLot(lotId).spec.seller, ingrid);
    }

    function test_tUsdLot() public {
        (uint256 lotId, IContinuousClearingAuction a) = _list(_cod(address(tusd)));
        assertEq(a.currency(), address(tusd));
        vm.roll(a.startBlock());
        _bid(a, buyerA, 8_000_000, 1000e6);
        assertEq(IERC20Like(address(tusd)).balanceOf(address(a)), 1000e6);
        assertEq(factory.getLot(lotId).spec.currency, address(tusd));
    }

    // ------------------------------------------------------------------ listing reverts

    function test_RevertWhen_unauthorizedLister() public {
        LotFactory.LotSpec memory spec = _cod(address(teur));
        vm.expectRevert(abi.encodeWithSelector(LotFactory.NotAuthorized.selector, stranger));
        vm.prank(stranger);
        factory.createLot(spec);
        // A seller cannot list on behalf of another seller.
        address other = makeAddr("other.seller");
        vm.prank(op);
        reg.register(other, 1, "other");
        vm.expectRevert(abi.encodeWithSelector(LotFactory.NotAuthorized.selector, other));
        vm.prank(other);
        factory.createLot(spec);
    }

    function test_RevertWhen_sellerCannotList() public {
        LotFactory.LotSpec memory spec = _cod(address(teur));
        spec.seller = buyerA; // a buyer, not a lister
        vm.expectRevert(abi.encodeWithSelector(LotFactory.SellerCannotList.selector, buyerA));
        vm.prank(buyerA);
        factory.createLot(spec);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.SellerCannotList.selector, buyerA));
        vm.prank(op);
        factory.createLot(spec);
    }

    function test_RevertWhen_currencyNotAllowed() public {
        MockStable rogue = new MockStable("Rogue", "RGE", op);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.CurrencyNotAllowed.selector, address(rogue)));
        vm.prank(ingrid);
        factory.createLot(_cod(address(rogue)));
        // Removing a currency blocks new lots in it.
        vm.prank(op);
        factory.setCurrency(address(teur), false);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.CurrencyNotAllowed.selector, address(teur)));
        vm.prank(ingrid);
        factory.createLot(_cod(address(teur)));
    }

    function test_RevertWhen_badSpec() public {
        LotFactory.LotSpec memory s;
        vm.startPrank(ingrid);
        s = _cod(address(teur));
        s.qty = 0;
        vm.expectRevert(LotFactory.ZeroQty.selector);
        factory.createLot(s);
        s = _cod(address(teur));
        s.qty = type(uint128).max / 1e18 + 1;
        vm.expectRevert(abi.encodeWithSelector(LotFactory.QtyTooLarge.selector, s.qty));
        factory.createLot(s);
        s = _cod(address(teur));
        s.durationBlocks = 1;
        vm.expectRevert(abi.encodeWithSelector(LotFactory.DurationTooShort.selector, 1));
        factory.createLot(s);
        s = _cod(address(teur));
        s.pickupWindowBlocks = 0;
        vm.expectRevert(LotFactory.ZeroPickupWindow.selector);
        factory.createLot(s);
        s = _cod(address(teur));
        s.sector = "cod";
        vm.expectRevert(abi.encodeWithSelector(LotFactory.UnknownSector.selector, bytes32("cod")));
        factory.createLot(s);
        s = _cod(address(teur));
        s.floorPerUnit = 999;
        vm.expectRevert(abi.encodeWithSelector(LotFactory.FloorTooLow.selector, 999));
        factory.createLot(s);
        s = _cod(address(teur));
        s.parentLotId = 7;
        vm.expectRevert(abi.encodeWithSelector(LotFactory.UnknownParent.selector, 7));
        factory.createLot(s);
        vm.stopPrank();
    }

    function test_relistOnlyBySettlementWithParent() public {
        (uint256 parent,) = _list(_cod(address(teur)));
        LotFactory.LotSpec memory s = _cod(address(teur));
        s.parentLotId = parent;
        s.floorPerUnit = 6_375_000;
        vm.expectRevert(abi.encodeWithSelector(LotFactory.NotSettlement.selector, ingrid));
        vm.prank(ingrid);
        factory.createRelistedLot(s);
        s.parentLotId = 0;
        vm.expectRevert(abi.encodeWithSelector(LotFactory.UnknownParent.selector, 0));
        vm.prank(settlement);
        factory.createRelistedLot(s);
        s.parentLotId = parent;
        vm.prank(settlement);
        (uint256 relisted,,) = factory.createRelistedLot(s);
        assertEq(relisted, 2);
        assertEq(factory.getLot(relisted).spec.parentLotId, parent);
        assertTrue(factory.getLot(relisted).token != factory.getLot(parent).token, "new token");
    }

    // ------------------------------------------------------------------ sectors, roles, parents (S1 3.1, D-62)

    function _specFor(bytes32 sector, address seller, uint256 parent)
        internal
        view
        returns (LotFactory.LotSpec memory s)
    {
        s = _cod(address(teur));
        s.sector = sector;
        s.seller = seller;
        s.parentLotId = parent;
    }

    function _expectWrongRole(bytes32 sector, address seller, uint8 role, address caller) internal {
        LotFactory.LotSpec memory s = _specFor(sector, seller, 0);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.WrongRole.selector, seller, sector, role));
        vm.prank(caller);
        factory.createLot(s);
    }

    function test_eachSectorListsWithItsRole() public {
        address truck = _registered("lars.truck", reg.TRUCK());
        address store = _registered("fjord.cold_store", reg.STORAGE());
        address gpu = _registered("northlight.compute", reg.SELLER());
        (uint256 fish,) = _list(_specFor(Keys.FISH, ingrid, 0));
        _list(_specFor(Keys.PRODUCE, ingrid, 0));
        _list(_specFor(Keys.FLOWERS, ingrid, 0));
        _list(_specFor(Keys.COMPUTE, gpu, 0));
        (uint256 t,) = _list(_specFor(Keys.TRUCK, truck, fish)); // chained
        (uint256 d,) = _list(_specFor(Keys.TRUCK, truck, 0)); // standalone (Dallas)
        (uint256 st,) = _list(_specFor(Keys.STORAGE, store, fish));
        assertEq(factory.getLot(t).spec.parentLotId, fish);
        assertEq(factory.getLot(d).spec.parentLotId, 0);
        assertEq(factory.getLot(st).spec.parentLotId, fish);
        // An operator listing for a seller is held to the seller's role, not its own.
        vm.prank(op);
        factory.createLot(_specFor(Keys.TRUCK, truck, fish));
    }

    function test_RevertWhen_sellerRoleDoesNotMatchSector() public {
        uint8 tr = reg.TRUCK();
        uint8 sto = reg.STORAGE();
        uint8 sel = reg.SELLER();
        address truck = _registered("lars.truck", tr);
        address store = _registered("fjord.cold_store", sto);
        _expectWrongRole(Keys.TRUCK, ingrid, sel, ingrid);
        _expectWrongRole(Keys.STORAGE, ingrid, sel, ingrid);
        _expectWrongRole(Keys.FISH, truck, tr, truck);
        _expectWrongRole(Keys.COMPUTE, truck, tr, truck);
        _expectWrongRole(Keys.STORAGE, truck, tr, truck);
        _expectWrongRole(Keys.PRODUCE, store, sto, store);
        _expectWrongRole(Keys.TRUCK, store, sto, store);
        _expectWrongRole(Keys.COMPUTE, store, sto, op); // operator cannot bypass it
    }

    function test_RevertWhen_badParent() public {
        address truck = _registered("lars.truck", reg.TRUCK());
        address store = _registered("fjord.cold_store", reg.STORAGE());
        address gpu = _registered("northlight.compute", reg.SELLER());
        (uint256 fish,) = _list(_specFor(Keys.FISH, ingrid, 0));
        (uint256 compute,) = _list(_specFor(Keys.COMPUTE, gpu, 0));
        (uint256 t,) = _list(_specFor(Keys.TRUCK, truck, fish));
        (uint256 st,) = _list(_specFor(Keys.STORAGE, store, fish));

        // Only truck and storage lots may name a parent.
        bytes32[4] memory unchained = [Keys.FISH, Keys.PRODUCE, Keys.FLOWERS, Keys.COMPUTE];
        for (uint256 i; i < unchained.length; i++) {
            address who = unchained[i] == Keys.COMPUTE ? gpu : ingrid;
            LotFactory.LotSpec memory s = _specFor(unchained[i], who, fish);
            vm.expectRevert(abi.encodeWithSelector(LotFactory.ParentNotAllowed.selector, unchained[i]));
            vm.prank(who);
            factory.createLot(s);
        }
        // The parent must be goods that move: not a truck, storage or compute lot.
        uint256[3] memory badParents = [t, st, compute];
        bytes32[3] memory badSectors = [Keys.TRUCK, Keys.STORAGE, Keys.COMPUTE];
        for (uint256 i; i < badParents.length; i++) {
            LotFactory.LotSpec memory s = _specFor(Keys.TRUCK, truck, badParents[i]);
            vm.expectRevert(abi.encodeWithSelector(LotFactory.BadParent.selector, badParents[i], badSectors[i]));
            vm.prank(truck);
            factory.createLot(s);
            s = _specFor(Keys.STORAGE, store, badParents[i]);
            vm.expectRevert(abi.encodeWithSelector(LotFactory.BadParent.selector, badParents[i], badSectors[i]));
            vm.prank(store);
            factory.createLot(s);
        }
        // Unknown parent still reports UnknownParent first.
        LotFactory.LotSpec memory u = _specFor(Keys.TRUCK, truck, 99);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.UnknownParent.selector, 99));
        vm.prank(truck);
        factory.createLot(u);
    }

    function test_RevertWhen_adminCallsByStranger() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, factory.OPERATOR_ROLE()
            )
        );
        vm.prank(stranger);
        factory.setCurrency(address(teur), false);
        vm.expectRevert(LotFactory.ZeroAddress.selector);
        vm.prank(op);
        factory.setCurrency(address(0), true);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.UnknownLot.selector, 0));
        factory.getLot(0);
        vm.expectRevert(abi.encodeWithSelector(LotFactory.UnknownLot.selector, 1));
        factory.getLot(1);
    }

    // ------------------------------------------------------------------ bidding reverts

    function test_RevertWhen_unregisteredBids() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        vm.roll(a.startBlock());
        vm.prank(op);
        teur.mint(stranger, 1000e6);
        vm.startPrank(stranger);
        teur.approve(PERMIT2, type(uint256).max);
        (bool ok,) = PERMIT2.call(
            abi.encodeWithSignature(
                "approve(address,address,uint160,uint48)",
                address(teur),
                address(a),
                type(uint160).max,
                type(uint48).max
            )
        );
        assertTrue(ok);
        uint256 price = _priceQ96(a, 8_000_000);
        bytes memory inner = abi.encodeWithSelector(AgentRegistryHook.NotABidder.selector, stranger);
        vm.expectRevert(abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, inner));
        a.submitBid(price, uint128(100e6), stranger, "");
        vm.stopPrank();
    }

    function test_RevertWhen_bidAtClearing() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        vm.roll(a.startBlock());
        uint256 floorQ = a.floorPrice();
        vm.expectRevert(ICcaErrors.BidMustBeAboveClearingPrice.selector);
        vm.prank(buyerA);
        a.submitBid(floorQ, uint128(100e6), buyerA, "");
    }

    function test_RevertWhen_lateBid() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        vm.roll(a.endBlock());
        uint256 price = _priceQ96(a, 8_000_000);
        vm.expectRevert(ICcaErrors.AuctionIsOver.selector);
        vm.prank(buyerA);
        a.submitBid(price, uint128(100e6), buyerA, "");
    }

    function test_RevertWhen_bidWithoutPermit2Allowance() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        vm.roll(a.startBlock());
        // Revoke buyerA's Permit2 allowance for this auction: the currency pull must fail.
        vm.prank(buyerA);
        (bool ok,) = PERMIT2.call(
            abi.encodeWithSignature(
                "approve(address,address,uint160,uint48)", address(teur), address(a), uint160(0), uint48(0)
            )
        );
        assertTrue(ok);
        uint256 price = _priceQ96(a, 8_000_000);
        vm.expectRevert();
        vm.prank(buyerA);
        a.submitBid(price, uint128(100e6), buyerA, "");
    }

    // ------------------------------------------------------------------ full auction

    /// 600 kg cod at EUR 7.50 for 45 blocks, three buyers through Permit2. Demand above supply, so A is outbid.
    function test_fullAuction_threeBuyers() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        Placed[] memory bids = new Placed[](3);
        vm.roll(a.startBlock());
        bids[0] = _bid(a, buyerA, 8_000_000, 2000e6); // max 8.00
        uint256 last = a.checkpoint().clearingPrice;
        for (uint64 b = a.startBlock() + 1; b < a.endBlock(); b++) {
            vm.roll(b);
            if (b == a.startBlock() + 10) bids[1] = _bid(a, buyerB, 9_000_000, 4000e6); // max 9.00
            if (b == a.startBlock() + 20) bids[2] = _bid(a, buyerC, 10_000_000, 4000e6); // max 10.00
            uint256 c = a.checkpoint().clearingPrice;
            assertGe(c, last, "clearing never decreases");
            last = c;
        }
        vm.roll(a.endBlock());
        uint256 finalClearing = a.clearingPrice();
        assertGe(finalClearing, last);
        assertGt(finalClearing, _priceQ96(a, 8_000_000), "A is outbid");

        // Settlement sweeps (both recipients).
        IERC20Like cur = IERC20Like(address(teur));
        IERC20Like tok = IERC20Like(a.token());
        vm.startPrank(settlement);
        a.sweepCurrency();
        a.sweepUnsoldTokens();
        vm.stopPrank();
        uint256 raised = cur.balanceOf(settlement);
        uint256 unsold = tok.balanceOf(settlement);
        assertGt(raised, 0);

        (uint256[] memory refunds, uint256[] memory tokens) = _exitAndClaim(a, bids);
        uint256 totalIn = 10_000e6;
        uint256 refunded = refunds[0] + refunds[1] + refunds[2];
        uint256 claimed = tokens[0] + tokens[1] + tokens[2];
        console.log("raised (base units)", raised);
        console.log("refunded", refunded);
        console.log("claimed tokens", claimed, "unsold", unsold);
        console.log("final clearing per kg", PriceMath.fromQ96(finalClearing));

        assertGt(refunds[0], 0, "outbid A refunded");
        assertGt(tokens[2], 0, "winner C claims tokens");
        // Conservation, with CCA's round-down dust left in the auction.
        assertLe(raised + refunded, totalIn);
        assertLe(totalIn - raised - refunded, 10, "currency dust");
        assertLe(claimed + unsold, 600e18);
        assertLe(600e18 - claimed - unsold, 1e12, "token dust");
        // Raised matches what settlement will read in 1.3.
        assertEq(raised, a.currencyRaised());
    }

    function test_zeroBidsAuction() public {
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        vm.roll(a.endBlock());
        vm.startPrank(settlement);
        a.sweepCurrency();
        a.sweepUnsoldTokens();
        vm.stopPrank();
        assertEq(IERC20Like(address(teur)).balanceOf(settlement), 0);
        assertEq(IERC20Like(a.token()).balanceOf(settlement), 600e18, "all supply back to settlement");
    }

    function test_sizeUnderEip170() public view {
        assertLe(address(factory).code.length, 24_576);
    }

    // ------------------------------------------------------------------ price spread

    /// Average paid per kg, in base units: currency spent * 1e18 / tokens received.
    function _avg(uint256 amount, uint256 refund, uint256 tokens) internal pure returns (uint256) {
        return (amount - refund) * 1e18 / tokens;
    }

    /// Early bidder (first block) vs late bidder (last block), same max price and amount, with rising demand.
    /// Returns the spread of their average prices in bps of the lower one.
    function _spreadBps(uint256 shareBps) internal returns (uint256 spread, uint256 avgEarly, uint256 avgLate) {
        _deploy(shareBps);
        (, IContinuousClearingAuction a) = _list(_cod(address(teur)));
        address early = buyerA;
        address late = buyerB;
        address crowd = buyerC;
        Placed[] memory bids = new Placed[](6);
        vm.roll(a.startBlock());
        bids[0] = _bid(a, early, 10_000_000, 1500e6);
        bids[1] = _bid(a, crowd, 8_000_000, 1500e6);
        vm.roll(a.startBlock() + 15);
        bids[2] = _bid(a, crowd, 8_500_000, 1500e6);
        vm.roll(a.startBlock() + 30);
        bids[3] = _bid(a, crowd, 9_000_000, 1500e6);
        vm.roll(a.startBlock() + 40);
        bids[4] = _bid(a, crowd, 9_500_000, 1500e6);
        vm.roll(a.endBlock() - 1); // last block of the auction: carries `shareBps` of supply
        bids[5] = _bid(a, late, 10_000_000, 1500e6);
        vm.roll(a.endBlock());
        (uint256[] memory refunds, uint256[] memory tokens) = _exitAndClaim(a, bids);
        avgEarly = _avg(bids[0].amount, refunds[0], tokens[0]);
        avgLate = _avg(bids[5].amount, refunds[5], tokens[5]);
        uint256 lo = avgEarly < avgLate ? avgEarly : avgLate;
        uint256 hi = avgEarly < avgLate ? avgLate : avgEarly;
        spread = (hi - lo) * 10_000 / lo;
    }

    /// Guide 1.2: at the default share, early and late bidders at the same max end within 5%.
    function test_spreadWithin5PctAtDefaultShare() public {
        (uint256 spread, uint256 e, uint256 l) = _spreadBps(DEFAULT_SHARE_BPS);
        console.log("default share: avg early / late per kg (base units)", e, l);
        console.log("spread bps", spread);
        assertLe(spread, 500, "spread above 5%: raise LAST_BLOCK_SHARE_BPS and record it");
    }

    /// Records the spread across shares for NOTES.md. Not an assertion beyond sanity.
    function test_spreadTable() public {
        uint256[5] memory shares = [uint256(0), 2500, 5000, 7500, 9000];
        for (uint256 i; i < shares.length; i++) {
            (uint256 spread, uint256 e, uint256 l) = _spreadBps(shares[i]);
            console.log("share", shares[i]);
            console.log("  avg early, avg late", e, l);
            console.log("  spread bps", spread);
        }
    }
}
