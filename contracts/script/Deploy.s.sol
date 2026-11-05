// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ContinuousClearingAuctionFactory} from "continuous-clearing-auction/ContinuousClearingAuctionFactory.sol";
import {IDistributorFactory} from "liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {MockStable} from "../src/tokens/MockStable.sol";
import {AgentRegistry, IAgentRegistry} from "../src/registry/AgentRegistry.sol";
import {AgentRegistryHook} from "../src/registry/AgentRegistryHook.sol";
import {LotFactory} from "../src/LotFactory.sol";
import {ChainTrigger} from "../src/ChainTrigger.sol";
import {MarketSettlement} from "../src/MarketSettlement.sol";
import {StubSignalOracle, StubDisputeResolver} from "../src/oracles/StubOracles.sol";

/// @title Deploy (v1)
/// @notice Deploys the S1 stack and writes deployments/<network>.json (contract section 8).
///         Env: DEPLOY_NETWORK (anvil | base-sepolia), DEPLOY_COMMIT, DEPLOYER_PRIVATE_KEY, OPERATOR_PRIVATE_KEY,
///         TREASURY_ADDRESS, protocol params (.env.example), optional DEPLOY_OUT (tests).
///         Keys are read with vm.envUint and never logged.
contract Deploy is Script {
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant CIRCLE_TEST_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant CIRCLE_TEST_EURC = 0x808456652fdb597867f38412077A9182bf77359F;
    address internal constant CRE_FORWARDER_DEFAULT = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;

    struct Out {
        address tusd;
        address teur;
        address registry;
        address hook;
        address ccaFactory;
        address signalOracle;
        address disputeResolver;
        address factory;
        address trigger;
        address settlement;
    }

    error UnknownNetwork(string network);
    error WrongChain(uint256 chainId);
    error PredictionMismatch(address predicted, address deployed);
    error MissingExternal(address account);

    function run() external returns (Out memory o) {
        string memory network = vm.envString("DEPLOY_NETWORK");
        bool isAnvil = keccak256(bytes(network)) == keccak256("anvil");
        if (!isAnvil && keccak256(bytes(network)) != keccak256("base-sepolia")) revert UnknownNetwork(network);
        // Both targets are Base Sepolia state: anvil is a fork (pnpm chain:fork, --chain-id 84532).
        if (block.chainid != 84_532) revert WrongChain(block.chainid);
        // Permit2 and the Circle test tokens must exist (a plain anvil without a fork has none).
        if (PERMIT2.code.length == 0) revert MissingExternal(PERMIT2);
        if (CIRCLE_TEST_USDC.code.length == 0) revert MissingExternal(CIRCLE_TEST_USDC);

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address operator = vm.addr(vm.envUint("OPERATOR_PRIVATE_KEY"));
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        MarketSettlement.Params memory p = _params();
        uint256 shareBps = vm.envOr("LAST_BLOCK_SHARE_BPS", uint256(7500));
        uint256 startBlock = block.number;

        vm.startBroadcast(deployerKey);
        o.tusd = address(new MockStable("Test USD", "tUSD", deployer));
        o.teur = address(new MockStable("Test EUR", "tEUR", deployer));
        o.registry = address(new AgentRegistry(deployer));
        o.hook = address(new AgentRegistryHook(IAgentRegistry(o.registry)));
        o.ccaFactory = address(new ContinuousClearingAuctionFactory(address(0))); // D-04: zero fee controller
        o.signalOracle = address(new StubSignalOracle());
        o.disputeResolver = address(new StubDisputeResolver());

        // D-41: LotFactory (+0), ChainTrigger (+1), MarketSettlement (+2) from the deployer's next nonces.
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 2);
        o.factory = address(
            new LotFactory(
                deployer,
                IDistributorFactory(o.ccaFactory),
                IAgentRegistry(o.registry),
                o.hook,
                predicted,
                address(0),
                shareBps
            )
        );
        o.trigger = address(new ChainTrigger(predicted, LotFactory(o.factory)));
        o.settlement = address(
            new MarketSettlement(deployer, LotFactory(o.factory), ChainTrigger(o.trigger), address(0), treasury, p)
        );
        if (o.settlement != predicted) revert PredictionMismatch(predicted, o.settlement);

        _wire(o, operator);
        vm.stopBroadcast();

        _write(network, startBlock, o, p);
    }

    function _params() internal view returns (MarketSettlement.Params memory p) {
        p.feeBps = uint16(vm.envOr("FEE_BPS", uint256(100)));
        p.advanceNewBps = uint16(vm.envOr("ADVANCE_NEW_BPS", uint256(5000)));
        p.advanceProvenBps = uint16(vm.envOr("ADVANCE_PROVEN_BPS", uint256(9000)));
        p.advanceTruckBps = uint16(vm.envOr("ADVANCE_TRUCK_BPS", uint256(1000)));
        p.provenAfter = uint32(vm.envOr("PROVEN_AFTER_CLEAN_LOTS", uint256(3)));
        p.contestWindowBlocks = uint64(vm.envOr("CONTEST_WINDOW_BLOCKS", uint256(600)));
        p.reportWindowBlocks = uint64(vm.envOr("REPORT_WINDOW_BLOCKS", uint256(3000)));
    }

    /// Operator gets OPERATOR_ROLE everywhere; the deployer keeps DEFAULT_ADMIN_ROLE. Currencies per D-03.
    function _wire(Out memory o, address operator) internal {
        bytes32 role = keccak256("OPERATOR_ROLE");
        MockStable(o.tusd).grantRole(role, operator);
        MockStable(o.teur).grantRole(role, operator);
        AgentRegistry(o.registry).grantRole(role, operator);
        LotFactory(o.factory).grantRole(role, operator);
        MarketSettlement(o.settlement).grantRole(role, operator);
        LotFactory f = LotFactory(o.factory);
        f.setCurrency(o.tusd, true);
        f.setCurrency(o.teur, true);
        f.setCurrency(CIRCLE_TEST_USDC, true);
        f.setCurrency(CIRCLE_TEST_EURC, true);
    }

    function _write(string memory network, uint256 startBlock, Out memory o, MarketSettlement.Params memory p)
        internal
    {
        string memory c = "contracts";
        vm.serializeAddress(c, "TestUSD", o.tusd);
        vm.serializeAddress(c, "TestEUR", o.teur);
        vm.serializeAddress(c, "AgentRegistry", o.registry);
        vm.serializeAddress(c, "AgentRegistryHook", o.hook);
        vm.serializeAddress(c, "LotFactory", o.factory);
        vm.serializeAddress(c, "MarketSettlement", o.settlement);
        vm.serializeAddress(c, "ChainTrigger", o.trigger);
        vm.serializeAddress(c, "SignalOracle", o.signalOracle);
        vm.serializeAddress(c, "DisputeResolver", o.disputeResolver);
        string memory contractsJson = vm.serializeAddress(c, "CCAFactory", o.ccaFactory);

        string memory e = "external";
        vm.serializeAddress(e, "Permit2", PERMIT2);
        vm.serializeAddress(e, "CreForwarder", vm.envOr("CRE_FORWARDER_BASE_SEPOLIA", CRE_FORWARDER_DEFAULT));
        vm.serializeAddress(e, "CircleTestUSDC", CIRCLE_TEST_USDC);
        string memory externalJson = vm.serializeAddress(e, "CircleTestEURC", CIRCLE_TEST_EURC);

        string memory q = "params";
        vm.serializeUint(q, "feeBps", p.feeBps);
        vm.serializeUint(q, "advanceNewBps", p.advanceNewBps);
        vm.serializeUint(q, "advanceProvenBps", p.advanceProvenBps);
        vm.serializeUint(q, "advanceTruckBps", p.advanceTruckBps);
        vm.serializeUint(q, "provenAfter", p.provenAfter);
        vm.serializeUint(q, "contestWindowBlocks", p.contestWindowBlocks);
        string memory paramsJson = vm.serializeUint(q, "reportWindowBlocks", p.reportWindowBlocks);

        string memory r = "root";
        vm.serializeString(r, "network", network);
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeUint(r, "deployedAtBlock", startBlock);
        vm.serializeString(r, "commit", vm.envOr("DEPLOY_COMMIT", string("unknown")));
        vm.serializeString(r, "contracts", contractsJson);
        vm.serializeString(r, "external", externalJson);
        string memory out = vm.serializeString(r, "params", paramsJson);
        string memory path =
            vm.envOr("DEPLOY_OUT", string.concat(vm.projectRoot(), "/../deployments/", network, ".json"));
        vm.writeJson(out, path);
        console.log("Wrote", path);
        console.log("MarketSettlement", o.settlement);
        console.log("LotFactory", o.factory);
    }
}
