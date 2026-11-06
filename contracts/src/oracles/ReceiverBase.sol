// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver
/// @notice Chainlink CRE consumer interface (CRE docs, "Building consumer contracts"): the KeystoneForwarder, or the
///         MockKeystoneForwarder in simulation, calls `onReport` with the report metadata and the workflow's report.
///         Implementations must support it through ERC-165.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title ReceiverBase
/// @notice Shared CRE receiver: only the forwarder may deliver, an optional workflow-owner check, and a stale guard
///         for timestamped reports. Golden rule 8: receivers accept reports only from the forwarder and drop stale
///         ones (a stale report reverts, so nothing changes).
/// @dev The admin can change the forwarder: simulation uses the MockKeystoneForwarder, deployed workflows use the
///      KeystoneForwarder at a different address (CRE docs). Zero is never accepted, so validation cannot be switched
///      off by mistake.
abstract contract ReceiverBase is IReceiver, AccessControl {
    /// @notice A timestamped report older than this is stale (D-64).
    uint64 public constant STALE_AFTER = 1 hours;
    /// @notice Tolerance for a report timestamp ahead of the block's (node clock vs block time).
    uint64 public constant MAX_CLOCK_SKEW = 60;
    /// @dev Forwarder metadata: abi.encodePacked(workflowId bytes32, workflowName bytes10, workflowOwner address).
    uint256 internal constant OWNER_OFFSET = 42;
    uint256 internal constant OWNER_END = 62;

    address public forwarder;
    /// @notice When set, reports must come from workflows owned by this address. Zero means not checked.
    address public expectedWorkflowOwner;

    event ForwarderUpdated(address indexed previous, address indexed current);
    event ExpectedWorkflowOwnerUpdated(address indexed previous, address indexed current);

    error ZeroAddress();
    error NotForwarder(address caller);
    error BadMetadata(uint256 length);
    error WrongWorkflowOwner(address owner, address expected);
    error StaleReport(uint64 asOf, uint64 latest);
    error ReportTooOld(uint64 asOf, uint256 blockTime);
    error ReportFromFuture(uint64 asOf, uint256 blockTime);

    constructor(address admin, address forwarder_) {
        if (admin == address(0) || forwarder_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        forwarder = forwarder_;
        emit ForwarderUpdated(address(0), forwarder_);
    }

    function setForwarder(address forwarder_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (forwarder_ == address(0)) revert ZeroAddress();
        emit ForwarderUpdated(forwarder, forwarder_);
        forwarder = forwarder_;
    }

    // forge-lint: disable-next-line(missing-zero-check) zero switches the optional owner check off
    function setExpectedWorkflowOwner(address owner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ExpectedWorkflowOwnerUpdated(expectedWorkflowOwner, owner);
        expectedWorkflowOwner = owner;
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        address expected = expectedWorkflowOwner;
        if (expected != address(0)) {
            if (metadata.length < OWNER_END) revert BadMetadata(metadata.length);
            address owner = address(bytes20(metadata[OWNER_OFFSET:OWNER_END]));
            if (owner != expected) revert WrongWorkflowOwner(owner, expected);
        }
        _processReport(report);
    }

    function _processReport(bytes calldata report) internal virtual;

    /// @dev `asOf` is the workflow's trigger time in unix seconds (deterministic across nodes). It must be newer than
    ///      the stored value, at most STALE_AFTER old and not ahead of the block by more than MAX_CLOCK_SKEW.
    ///      Block time is the right clock here: report times are wall-clock seconds, and a few seconds of validator
    ///      drift against a one-hour window does not matter.
    function _checkFresh(uint64 asOf, uint64 latest) internal view {
        if (asOf <= latest) revert StaleReport(asOf, latest);
        // forge-lint: disable-next-line(block-timestamp)
        if (asOf > block.timestamp + MAX_CLOCK_SKEW) revert ReportFromFuture(asOf, block.timestamp);
        // forge-lint: disable-next-line(block-timestamp)
        if (asOf + STALE_AFTER < block.timestamp) revert ReportTooOld(asOf, block.timestamp);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl, IERC165) returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || super.supportsInterface(interfaceId);
    }
}
