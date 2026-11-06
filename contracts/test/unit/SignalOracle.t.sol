// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver, ReceiverBase} from "../../src/oracles/ReceiverBase.sol";
import {SignalOracle} from "../../src/oracles/SignalOracle.sol";

/// ReceiverBase and SignalOracle (contract 7.7, ICR-005 asOf): forwarder only, ERC-165, kinds 1 to 3, stale guard.
contract SignalOracleTest is Test {
    event ReferencePriceUpdated(
        bytes32 indexed commodity,
        bytes32 indexed market,
        uint256 perUnit,
        bytes32 currencyCode,
        bytes32 sourceTag,
        uint64 updatedAt
    );
    event FxUpdated(bytes32 indexed currencyCode, uint256 perUsdE8, uint64 updatedAt);
    event DemandSignal(
        uint256 indexed id,
        bytes32 indexed signalKind,
        bytes32 indexed place,
        uint8 severity,
        uint64 expiresAtBlock,
        string label
    );
    event ForwarderUpdated(address indexed previous, address indexed current);

    uint64 constant NOW = 1_800_000_000;
    address admin = makeAddr("admin");
    address fwd = makeAddr("cre.forwarder");
    address stranger = makeAddr("stranger");
    SignalOracle oracle;

    function setUp() public {
        vm.warp(NOW);
        vm.roll(1000);
        oracle = new SignalOracle(admin, fwd);
    }

    // ------------------------------------------------------------------ report builders

    function _ref(bytes32 commodity, uint256 perUnit, uint64 asOf) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(1), abi.encode(commodity, bytes32("fish_dock"), perUnit, bytes32("EUR"), bytes32("snap"), asOf)
        );
    }

    function _fx(bytes32 code, uint256 perUsdE8, uint64 asOf) internal pure returns (bytes memory) {
        return abi.encode(uint8(3), abi.encode(code, perUsdE8, asOf));
    }

    function _sig(uint64 expiresAtBlock) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(2), abi.encode(bytes32("festival"), bytes32("mumbai"), uint8(3), expiresAtBlock, "Diwali 8 Nov")
        );
    }

    function _deliver(bytes memory report) internal {
        vm.prank(fwd);
        oracle.onReport("", report);
    }

    // ------------------------------------------------------------------ receiver basics

    function test_erc165() public view {
        assertEq(type(IReceiver).interfaceId, bytes4(keccak256("onReport(bytes,bytes)")));
        assertTrue(oracle.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(oracle.supportsInterface(type(IERC165).interfaceId));
        assertTrue(oracle.supportsInterface(type(IAccessControl).interfaceId));
        assertFalse(oracle.supportsInterface(0xdeadbeef));
    }

    function test_RevertWhen_notForwarder() public {
        bytes memory r = _fx("EUR", 92_000_000, NOW);
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.NotForwarder.selector, stranger));
        vm.prank(stranger);
        oracle.onReport("", r);
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.NotForwarder.selector, admin));
        vm.prank(admin); // not even the admin
        oracle.onReport("", r);
    }

    function testFuzz_onlyForwarderDelivers(address caller) public {
        vm.assume(caller != fwd);
        bytes memory r = _fx("EUR", 92_000_000, NOW);
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.NotForwarder.selector, caller));
        vm.prank(caller);
        oracle.onReport("", r);
    }

    function test_RevertWhen_constructedWithZero() public {
        vm.expectRevert(ReceiverBase.ZeroAddress.selector);
        new SignalOracle(admin, address(0));
        vm.expectRevert(ReceiverBase.ZeroAddress.selector);
        new SignalOracle(address(0), fwd);
    }

    function test_adminSwitchesForwarder_simulationToProduction() public {
        address prod = makeAddr("keystone.forwarder");
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, oracle.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(stranger);
        oracle.setForwarder(prod);
        vm.expectRevert(ReceiverBase.ZeroAddress.selector);
        vm.prank(admin);
        oracle.setForwarder(address(0));

        vm.expectEmit(address(oracle));
        emit ForwarderUpdated(fwd, prod);
        vm.prank(admin);
        oracle.setForwarder(prod);
        bytes memory r = _fx("EUR", 92_000_000, NOW);
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.NotForwarder.selector, fwd));
        vm.prank(fwd);
        oracle.onReport("", r);
        vm.prank(prod);
        oracle.onReport("", r);
    }

    function test_workflowOwnerCheck() public {
        address owner = makeAddr("workflow.owner");
        bytes memory good = abi.encodePacked(bytes32("wf-id"), bytes10("fx-ref"), owner);
        bytes memory bad = abi.encodePacked(bytes32("wf-id"), bytes10("fx-ref"), stranger);
        // Off by default: any metadata is fine.
        vm.prank(fwd);
        oracle.onReport(bad, _fx("EUR", 92_000_000, NOW - 10));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, oracle.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(stranger);
        oracle.setExpectedWorkflowOwner(owner);
        vm.prank(admin);
        oracle.setExpectedWorkflowOwner(owner);

        bytes memory r = _fx("EUR", 93_000_000, NOW);
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.WrongWorkflowOwner.selector, stranger, owner));
        vm.prank(fwd);
        oracle.onReport(bad, r);
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.BadMetadata.selector, 0));
        vm.prank(fwd);
        oracle.onReport("", r);
        // The production forwarder appends a 2-byte report id after the owner; still accepted.
        vm.prank(fwd);
        oracle.onReport(abi.encodePacked(good, bytes2(0x0001)), r);
        (uint256 rate,) = oracle.fxRate("EUR");
        assertEq(rate, 93_000_000);
    }

    // ------------------------------------------------------------------ kinds

    function test_kind1_referencePrice() public {
        vm.expectEmit(address(oracle));
        emit ReferencePriceUpdated("cod", "fish_dock", 8_300_000, "EUR", "snap", NOW - 5);
        _deliver(_ref("cod", 8_300_000, NOW - 5));
        (uint256 perUnit, bytes32 cur, bytes32 tag, uint64 at) = oracle.referencePrice("cod", "fish_dock");
        assertEq(perUnit, 8_300_000);
        assertEq(cur, "EUR");
        assertEq(tag, "snap");
        assertEq(at, NOW - 5);
        // Keys are independent.
        (perUnit,,,) = oracle.referencePrice("haddock", "fish_dock");
        assertEq(perUnit, 0);
    }

    function test_kind3_fx() public {
        vm.expectEmit(address(oracle));
        emit FxUpdated("INR", 8_350_000_000, NOW);
        _deliver(_fx("INR", 8_350_000_000, NOW));
        (uint256 rate, uint64 at) = oracle.fxRate("INR");
        assertEq(rate, 8_350_000_000);
        assertEq(at, NOW);
    }

    function test_kind2_signalIdsIncrement() public {
        vm.expectEmit(address(oracle));
        emit DemandSignal(1, "festival", "mumbai", 3, 5000, "Diwali 8 Nov");
        _deliver(_sig(5000));
        _deliver(_sig(5000)); // signals are events, not state: no freshness ordering
        assertEq(oracle.signalCount(), 2);
    }

    function test_RevertWhen_wrongKind() public {
        bytes memory body = abi.encode(bytes32("EUR"), uint256(1), NOW);
        uint8[3] memory bad = [0, 4, 255];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(SignalOracle.UnknownKind.selector, bad[i]));
            _deliver(abi.encode(bad[i], body));
        }
    }

    function test_RevertWhen_malformedOrEmpty() public {
        vm.expectRevert();
        _deliver(hex"01");
        vm.expectRevert(); // kind 1 with a kind 3 body
        _deliver(abi.encode(uint8(1), abi.encode(bytes32("EUR"), uint256(1), NOW)));
        vm.expectRevert(SignalOracle.ZeroValue.selector);
        _deliver(_fx("EUR", 0, NOW));
        vm.expectRevert(SignalOracle.ZeroValue.selector);
        _deliver(_ref("cod", 0, NOW));
        vm.expectRevert(SignalOracle.EmptyKey.selector);
        _deliver(_fx(bytes32(0), 1, NOW));
        vm.expectRevert(SignalOracle.EmptyKey.selector);
        _deliver(_ref(bytes32(0), 1, NOW));
        vm.expectRevert(SignalOracle.EmptyKey.selector);
        _deliver(abi.encode(uint8(2), abi.encode(bytes32(0), bytes32("mumbai"), uint8(1), uint64(5000), "")));
    }

    // ------------------------------------------------------------------ stale guard (D-64)

    function test_RevertWhen_stale() public {
        _deliver(_fx("EUR", 92_000_000, NOW - 100));
        // Replay or out of order: same or older asOf.
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.StaleReport.selector, NOW - 100, NOW - 100));
        _deliver(_fx("EUR", 91_000_000, NOW - 100));
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.StaleReport.selector, NOW - 200, NOW - 100));
        _deliver(_fx("EUR", 91_000_000, NOW - 200));
        (uint256 rate,) = oracle.fxRate("EUR");
        assertEq(rate, 92_000_000, "stale reports change nothing");

        // Delivered too late.
        uint64 old = NOW - 3601;
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.ReportTooOld.selector, old, NOW));
        _deliver(_fx("NOK", 1_100_000_000, old));
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.ReportTooOld.selector, old, NOW));
        _deliver(_ref("cod", 8_300_000, old));
        // From the future.
        vm.expectRevert(abi.encodeWithSelector(ReceiverBase.ReportFromFuture.selector, NOW + 61, NOW));
        _deliver(_fx("NOK", 1_100_000_000, NOW + 61));

        // Expired signals.
        vm.expectRevert(abi.encodeWithSelector(SignalOracle.SignalExpired.selector, 1000, 1000));
        _deliver(_sig(1000));
        vm.expectRevert(abi.encodeWithSelector(SignalOracle.SignalExpired.selector, 999, 1000));
        _deliver(_sig(999));
    }

    function test_staleBoundariesAccepted() public {
        _deliver(_fx("NOK", 1_100_000_000, NOW - 3600)); // exactly STALE_AFTER old
        _deliver(_fx("KES", 12_900_000_000, NOW + 60)); // exactly MAX_CLOCK_SKEW ahead
        _deliver(_sig(1001)); // expires next block
        assertEq(oracle.STALE_AFTER(), 3600);
        assertEq(oracle.MAX_CLOCK_SKEW(), 60);
    }

    function testFuzz_freshnessIsMonotonicPerKey(uint64 a, uint64 b) public {
        a = uint64(bound(a, NOW - 3600, NOW + 60));
        b = uint64(bound(b, NOW - 3600, NOW + 60));
        _deliver(_fx("EUR", 1, a));
        if (b <= a) {
            vm.expectRevert(abi.encodeWithSelector(ReceiverBase.StaleReport.selector, b, a));
            _deliver(_fx("EUR", 2, b));
        } else {
            _deliver(_fx("EUR", 2, b));
            (, uint64 at) = oracle.fxRate("EUR");
            assertEq(at, b);
        }
    }
}
