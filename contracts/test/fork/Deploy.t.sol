// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {MockStable} from "../../src/tokens/MockStable.sol";
import {AgentRegistry} from "../../src/registry/AgentRegistry.sol";
import {LotFactory} from "../../src/LotFactory.sol";
import {ChainTrigger} from "../../src/ChainTrigger.sol";
import {MarketSettlement} from "../../src/MarketSettlement.sol";
import {SignalOracle} from "../../src/oracles/SignalOracle.sol";
import {DisputeResolver} from "../../src/oracles/DisputeResolver.sol";
import {IReceiver, ReceiverBase} from "../../src/oracles/ReceiverBase.sol";

/// Runs script/Deploy.s.sol on a Base Sepolia fork with throwaway keys (generated per run, never stored) and
/// checks wiring, roles, currencies and the deployments JSON (contract section 8). v2 (S1 4.1): real CRE receivers,
/// and the guide's manual check automated: impersonate the Base Sepolia mock forwarder and deliver a signal.
contract DeployForkTest is Test {
    address internal constant MOCK_FORWARDER = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;

    string internal out;
    address internal deployer;
    address internal operator;
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        if (bytes(vm.envOr("RPC_URL", string(""))).length == 0) {
            vm.skip(true, "RPC_URL unset");
            return;
        }
        vm.createSelectFork("base_sepolia");
        uint256 dk = uint256(keccak256(abi.encode("deployer", block.timestamp, address(this))));
        uint256 ok = uint256(keccak256(abi.encode("operator", block.timestamp, address(this))));
        deployer = vm.addr(dk);
        operator = vm.addr(ok);
        vm.deal(deployer, 1 ether);
        out = string.concat(vm.projectRoot(), "/../deployments/.test-deploy.json");
        vm.setEnv("DEPLOY_NETWORK", "base-sepolia");
        vm.setEnv("DEPLOY_COMMIT", "test");
        vm.setEnv("DEPLOY_OUT", out);
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(dk));
        vm.setEnv("OPERATOR_PRIVATE_KEY", vm.toString(ok));
        vm.setEnv("TREASURY_ADDRESS", vm.toString(treasury));
        vm.setEnv("LAST_BLOCK_SHARE_BPS", "7500");
        // Pin every param the test asserts, so a developer's .env cannot change the outcome (D-50 values).
        vm.setEnv("CONTEST_WINDOW_BLOCKS", "600");
        vm.setEnv("REPORT_WINDOW_BLOCKS", "3000");
        vm.setEnv("FEE_BPS", "100");
        vm.setEnv("ADVANCE_PROVEN_BPS", "9000");
        vm.setEnv("CRE_FORWARDER_BASE_SEPOLIA", vm.toString(MOCK_FORWARDER));
        vm.setEnv("RULING_TIMEOUT_BLOCKS", "3000");
    }

    /// One test on purpose: vm.setEnv is process-wide and forge runs tests in parallel.
    function test_fork_deployWiresEverything() public {
        // Failure path first: an unknown network never deploys.
        vm.setEnv("DEPLOY_NETWORK", "mainnet");
        Deploy bad = new Deploy();
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnknownNetwork.selector, "mainnet"));
        bad.run();
        vm.setEnv("DEPLOY_NETWORK", "base-sepolia");

        Deploy.Out memory o = new Deploy().run();
        bytes32 role = keccak256("OPERATOR_ROLE");
        LotFactory f = LotFactory(o.factory);
        MarketSettlement ms = MarketSettlement(o.settlement);

        assertEq(f.settlement(), o.settlement, "factory -> settlement");
        assertEq(ChainTrigger(o.trigger).settlement(), o.settlement, "trigger -> settlement");
        assertEq(address(ms.factory()), o.factory);
        assertEq(address(ms.trigger()), o.trigger);
        assertEq(ms.resolver(), o.disputeResolver, "settlement -> resolver (v2)");
        assertEq(f.resolver(), o.disputeResolver, "factory -> resolver (LotToken escrow)");
        DisputeResolver dr = DisputeResolver(o.disputeResolver);
        assertEq(address(dr.settlement()), o.settlement);
        assertEq(address(dr.factory()), o.factory);
        assertEq(dr.rulingTimeoutBlocks(), 3000);
        assertEq(dr.forwarder(), MOCK_FORWARDER);
        assertEq(SignalOracle(o.signalOracle).forwarder(), MOCK_FORWARDER);
        assertTrue(dr.hasRole(dr.DEFAULT_ADMIN_ROLE(), deployer), "deployer can change the forwarder");
        assertEq(ms.treasury(), treasury);
        assertEq(f.lastBlockShareBps(), 7500);
        assertEq(ms.feeBps(), 100);
        assertEq(ms.contestWindowBlocks(), 600);
        assertEq(ms.reportWindowBlocks(), 3000);

        assertTrue(f.isCurrency(o.tusd) && f.isCurrency(o.teur), "tUSD, tEUR allowed");
        assertTrue(f.isCurrency(0x036CbD53842c5426634e7929541eC2318f3dCF7e), "Circle USDC allowed");
        assertTrue(f.isCurrency(0x808456652fdb597867f38412077A9182bf77359F), "Circle EURC allowed");
        assertEq(MockStable(o.tusd).decimals(), 6);

        assertTrue(f.hasRole(role, operator) && ms.hasRole(role, operator), "operator role");
        assertTrue(AgentRegistry(o.registry).hasRole(role, operator));
        assertTrue(MockStable(o.teur).hasRole(role, operator));
        assertTrue(f.hasRole(f.DEFAULT_ADMIN_ROLE(), deployer), "deployer keeps admin");

        // Receivers answer ERC-165 for IReceiver, and the real mock forwarder (code on Base Sepolia) can deliver.
        assertTrue(SignalOracle(o.signalOracle).supportsInterface(type(IReceiver).interfaceId));
        assertTrue(dr.supportsInterface(type(IReceiver).interfaceId));
        assertGt(MOCK_FORWARDER.code.length, 0, "mock forwarder deployed on Base Sepolia");
        uint64 asOf = uint64(block.timestamp);
        bytes memory fx = abi.encode(uint8(3), abi.encode(bytes32("EUR"), uint256(92_000_000), asOf));
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.NotForwarder.selector, address(this)));
        SignalOracle(o.signalOracle).onReport("", fx);
        vm.prank(MOCK_FORWARDER);
        SignalOracle(o.signalOracle).onReport("", fx);
        (uint256 rate, uint64 updatedAt) = SignalOracle(o.signalOracle).fxRate("EUR");
        assertEq(rate, 92_000_000);
        assertEq(updatedAt, asOf);

        string memory json = vm.readFile(out);
        assertEq(vm.parseJsonString(json, ".network"), "base-sepolia");
        assertEq(vm.parseJsonUint(json, ".chainId"), 84_532);
        assertEq(vm.parseJsonAddress(json, ".contracts.MarketSettlement"), o.settlement);
        assertEq(vm.parseJsonAddress(json, ".contracts.CCAFactory"), o.ccaFactory);
        assertEq(vm.parseJsonAddress(json, ".contracts.DisputeResolver"), o.disputeResolver);
        assertEq(vm.parseJsonAddress(json, ".contracts.SignalOracle"), o.signalOracle);
        assertEq(vm.parseJsonAddress(json, ".external.CreForwarder"), MOCK_FORWARDER);
        assertEq(vm.parseJsonAddress(json, ".external.Permit2"), 0x000000000022D473030F116dDEE9F6B43aC78BA3);
        assertEq(vm.parseJsonUint(json, ".params.advanceProvenBps"), 9000);
        vm.removeFile(out);
    }
}
