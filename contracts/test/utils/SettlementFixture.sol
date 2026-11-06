// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {LotFixture, IERC20Like} from "./LotFixture.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {ChainTrigger} from "../../src/ChainTrigger.sol";
import {MarketSettlement, IDisputeResolver} from "../../src/MarketSettlement.sol";
import {Keys} from "../../src/libraries/Keys.sol";

/// Stand-in for DisputeResolver (S1 4.1): records no-show rulings it is asked to open.
contract MockResolver is IDisputeResolver {
    uint256 public opened;

    function openNoShowRuling(uint256, address, uint256, bytes32, string calldata) external returns (uint256) {
        return ++opened;
    }
}

/// Full S1 wiring: LotFactory -> ChainTrigger -> MarketSettlement, with settlement's address predicted before
/// LotFactory is deployed, the same way the S1 1.4 deploy script will do it (D-41).
abstract contract SettlementFixture is LotFixture {
    // D-09 tiers, D-12 windows, D-26 proven threshold (.env.example values).
    uint16 internal constant FEE_BPS = 100;
    uint16 internal constant NEW_BPS = 5000;
    uint16 internal constant PROVEN_BPS = 9000;
    uint16 internal constant TRUCK_BPS = 1000;
    uint32 internal constant PROVEN_AFTER = 3;
    uint64 internal constant CONTEST = 60;
    uint64 internal constant REPORT = 300;

    ChainTrigger internal trigger;
    MarketSettlement internal ms;
    MockResolver internal resolver;
    address internal treasury = makeAddr("treasury");
    address internal lars; // truck seller (carrier)
    uint256 internal larsKey;
    uint256 internal ingridKey;
    address internal maya; // Dallas truck owner, standalone lots (S1 3.1)
    uint256 internal mayaKey;
    address internal vault; // cold store, STORAGE role (S1 3.1)
    uint256 internal vaultKey;
    address internal northlight; // GPU provider, lists compute as a SELLER (S1 3.1, D-62)
    uint256 internal northlightKey;
    bool internal withResolver = true;

    function _settlementAddress() internal view override returns (address) {
        // Next deployments from this contract: LotFactory (+0), ChainTrigger (+1), MarketSettlement (+2).
        return vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
    }

    function _deploy(uint256 shareBps) internal override {
        resolver = new MockResolver();
        super._deploy(shareBps);
        trigger = new ChainTrigger(settlement, factory);
        ms = new MarketSettlement(
            op,
            factory,
            trigger,
            withResolver ? address(resolver) : address(0),
            treasury,
            MarketSettlement.Params({
                feeBps: FEE_BPS,
                advanceNewBps: NEW_BPS,
                advanceProvenBps: PROVEN_BPS,
                advanceTruckBps: TRUCK_BPS,
                provenAfter: PROVEN_AFTER,
                contestWindowBlocks: CONTEST,
                reportWindowBlocks: REPORT
            })
        );
        assertEq(address(ms), settlement, "predicted settlement address");
        (, ingridKey) = makeAddrAndKey("ingrid.seller");
        (lars, larsKey) = makeAddrAndKey("lars.truck");
        (maya, mayaKey) = makeAddrAndKey("maya.truck");
        (vault, vaultKey) = makeAddrAndKey("fjord.cold_store");
        (northlight, northlightKey) = makeAddrAndKey("northlight.compute");
        uint8 truckRole = reg.TRUCK(); // read before the prank (NOTES: vm.prank gotcha)
        uint8 storageRole = reg.STORAGE();
        uint8 sellerRole = reg.SELLER();
        vm.startPrank(op);
        reg.register(lars, truckRole, "lars.truck");
        reg.register(maya, truckRole, "maya.truck");
        reg.register(vault, storageRole, "fjord.cold_store");
        reg.register(northlight, sellerRole, "northlight.compute");
        vm.stopPrank();
        for (uint256 i; i < buyers.length; i++) {
            vm.prank(buyers[i]);
            teur.approve(PERMIT2, type(uint256).max);
        }
    }

    /// Runs a lot to the end with the given bids (all in the first block), settles, then exits and claims.
    function _sell(
        LotFactory.LotSpec memory spec,
        address[] memory who,
        uint256[] memory maxPerUnit,
        uint256[] memory amt
    ) internal returns (uint256 lotId, uint256[] memory tokens, uint256[] memory refunds) {
        IContinuousClearingAuction a;
        (lotId, a) = _list(spec);
        Placed[] memory bids = new Placed[](who.length);
        vm.roll(a.startBlock());
        for (uint256 i; i < who.length; i++) {
            bids[i] = _bid(a, who[i], maxPerUnit[i], amt[i]);
        }
        vm.roll(a.endBlock());
        ms.settle(lotId);
        (refunds, tokens) = _exitAndClaim(a, bids);
    }

    function _sellTo(LotFactory.LotSpec memory spec, address buyer, uint256 amount)
        internal
        returns (uint256 lotId, uint256 tokens)
    {
        address[] memory who = new address[](1);
        uint256[] memory maxP = new uint256[](1);
        uint256[] memory amt = new uint256[](1);
        who[0] = buyer;
        maxP[0] = spec.floorPerUnit * 2;
        amt[0] = amount;
        uint256[] memory t;
        (lotId, t,) = _sell(spec, who, maxP, amt);
        tokens = t[0];
    }

    function _ticket(uint256 lotId, address buyer, uint256 tokenAmount, uint64 expiry, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ms.handoverDigest(lotId, buyer, tokenAmount, expiry));
        return abi.encodePacked(r, s, v);
    }

    function _handover(uint256 lotId, address buyer, uint256 tokenAmount, address sender, uint256 sellerKey) internal {
        uint64 expiry = uint64(vm.getBlockNumber() + 50);
        bytes memory sig = _ticket(lotId, buyer, tokenAmount, expiry, sellerKey);
        vm.prank(sender);
        ms.confirmHandover(lotId, buyer, tokenAmount, expiry, sig);
    }

    function _truckSpec(uint256 parentLotId) internal view returns (LotFactory.LotSpec memory s) {
        s = _cod(address(teur));
        s.sector = Keys.TRUCK;
        s.market = "freight_yard";
        s.commodity = "truck_capacity";
        s.grade = "na";
        s.place = "oslo";
        s.floorPerUnit = 100_000; // 0.10 per kg-route
        s.durationBlocks = 30;
        s.parentLotId = parentLotId;
        s.seller = lars;
    }

    function _bal(address token, address who) internal view returns (uint256) {
        return IERC20Like(token).balanceOf(who);
    }

    /// Index of the first log with event `sel` whose first indexed topic is `lotId`.
    function _indexOf(Vm.Log[] memory logs, bytes32 sel, uint256 lotId) internal pure returns (uint256) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 1 && logs[i].topics[0] == sel && uint256(logs[i].topics[1]) == lotId) {
                return i;
            }
        }
        revert("event not found");
    }

    function _assertNoEvent(Vm.Log[] memory logs, bytes32 sel) internal pure {
        for (uint256 i; i < logs.length; i++) {
            require(logs[i].topics.length == 0 || logs[i].topics[0] != sel, "unexpected event");
        }
    }
}
