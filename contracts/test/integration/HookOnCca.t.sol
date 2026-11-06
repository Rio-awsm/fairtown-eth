// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {
    IContinuousClearingAuctionFactory
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuctionFactory.sol";
import {ValidationHookLib} from "continuous-clearing-auction/libraries/ValidationHookLib.sol";
import {AgentRegistry, IAgentRegistry} from "../../src/registry/AgentRegistry.sol";
import {AgentRegistryHook} from "../../src/registry/AgentRegistryHook.sol";
import {LotToken} from "../../src/tokens/LotToken.sol";
import {PriceMath} from "../../src/libraries/PriceMath.sol";
import {Schedules} from "../../src/libraries/Schedules.sol";

/// A contract that tries to bid on behalf of someone else.
contract BidRouter {
    function bidFor(IContinuousClearingAuction auction, uint256 maxPrice, address owner) external payable {
        auction.submitBid{value: msg.value}(maxPrice, uint128(msg.value), owner, "");
    }
}

/// S1 1.1 against real CCA v2.1.0 code. Currency is native ETH here only to avoid Permit2 setup before 1.2;
/// the hook check runs before any currency logic matters.
contract HookOnCcaTest is Test {
    IContinuousClearingAuctionFactory internal factory;
    AgentRegistry internal reg;
    AgentRegistryHook internal hook;
    address internal op = makeAddr("operator");
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    uint256 internal constant SUPPLY = 600e18;
    uint256 internal constant FLOOR_PER_UNIT = 7_500_000; // 7.50 per kg

    function setUp() public {
        factory = IContinuousClearingAuctionFactory(
            vm.deployCode(
                "ContinuousClearingAuctionFactory.sol:ContinuousClearingAuctionFactory", abi.encode(address(0))
            )
        );
        reg = new AgentRegistry(op);
        hook = new AgentRegistryHook(IAgentRegistry(address(reg)));
        vm.startPrank(op);
        reg.register(buyer, 2, "buyer");
        reg.register(seller, 1, "seller");
        vm.stopPrank();
        vm.deal(buyer, 100 ether);
        vm.deal(seller, 100 ether);
    }

    function _auction(uint64 duration, uint256 shareBps, bytes32 salt)
        internal
        returns (IContinuousClearingAuction a, uint256 floorQ96, uint256 tick)
    {
        LotToken token = new LotToken("Lot 1 Cod", "LOT1", SUPPLY, address(this), address(this), address(0));
        tick = PriceMath.tickFor(PriceMath.toQ96(FLOOR_PER_UNIT));
        floorQ96 = PriceMath.floorToTick(PriceMath.toQ96(FLOOR_PER_UNIT), tick);
        uint64 start = uint64(block.number + 1);
        AuctionParameters memory p = AuctionParameters({
            currency: address(0),
            tokensRecipient: address(this),
            fundsRecipient: address(this),
            startBlock: start,
            endBlock: start + duration,
            claimBlock: start + duration,
            tickSpacing: tick,
            validationHook: address(hook),
            floorPrice: floorQ96,
            requiredCurrencyRaised: 0,
            auctionStepsData: Schedules.endWeighted(duration, shareBps)
        });
        a = IContinuousClearingAuction(address(factory.create(address(token), SUPPLY, abi.encode(p), salt)));
        token.transfer(address(a), SUPPLY);
        a.onTokensReceived();
        vm.roll(start);
    }

    function test_registeredBuyerBidsDirectly() public {
        (IContinuousClearingAuction a, uint256 floorQ96, uint256 tick) = _auction(45, 5000, "s");
        vm.prank(buyer);
        uint256 bidId = a.submitBid{value: 1 ether}(floorQ96 + tick, 1 ether, buyer, "");
        assertEq(bidId, 0);
    }

    function test_RevertWhen_routerBidsForBuyer() public {
        (IContinuousClearingAuction a, uint256 floorQ96, uint256 tick) = _auction(45, 5000, "s");
        BidRouter router = new BidRouter();
        bytes memory inner = abi.encodeWithSelector(AgentRegistryHook.SenderNotOwner.selector, address(router), buyer);
        vm.expectRevert(abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, inner));
        vm.prank(buyer);
        router.bidFor{value: 1 ether}(a, floorQ96 + tick, buyer);
    }

    function test_RevertWhen_sellerOrUnregisteredBids() public {
        (IContinuousClearingAuction a, uint256 floorQ96, uint256 tick) = _auction(45, 5000, "s");
        bytes memory inner = abi.encodeWithSelector(AgentRegistryHook.NotABidder.selector, seller);
        vm.expectRevert(abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, inner));
        vm.prank(seller);
        a.submitBid{value: 1 ether}(floorQ96 + tick, 1 ether, seller, "");

        address nobody = makeAddr("nobody");
        vm.deal(nobody, 1 ether);
        inner = abi.encodeWithSelector(AgentRegistryHook.NotABidder.selector, nobody);
        vm.expectRevert(abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, inner));
        vm.prank(nobody);
        a.submitBid{value: 1 ether}(floorQ96 + tick, 1 ether, nobody, "");
    }

    /// CCA's own constructor validation (StepStorage._validate) accepts endWeighted schedules.
    function test_ccaAcceptsEndWeightedSchedules() public {
        uint64[6] memory durations = [uint64(2), 3, 20, 45, 120, 500];
        uint256[4] memory shares = [uint256(0), 1, 5000, 9000];
        for (uint256 i; i < durations.length; i++) {
            for (uint256 j; j < shares.length; j++) {
                (IContinuousClearingAuction a,,) = _auction(durations[i], shares[j], bytes32(i * 10 + j));
                assertGt(address(a).code.length, 0);
                vm.roll(1);
            }
        }
    }

    function testFuzz_ccaAcceptsEndWeighted(uint64 duration, uint256 shareBps) public {
        duration = uint64(bound(duration, 2, 2000));
        shareBps = bound(shareBps, 0, 10_000);
        (IContinuousClearingAuction a,,) = _auction(duration, shareBps, "f");
        assertGt(address(a).code.length, 0);
    }
}
