// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReceiverBase} from "./ReceiverBase.sol";

/// @title SignalOracle
/// @notice CRE receiver for W1 (reference prices, FX) and W2 (demand signals), contract section 7.7.
///         report = abi.encode(uint8 kind, bytes body)
///         kind 1 reference: abi.encode(bytes32 commodity, bytes32 market, uint256 perUnit, bytes32 currencyCode,
///                                      bytes32 sourceTag, uint64 asOf)
///         kind 2 signal:    abi.encode(bytes32 signalKind, bytes32 place, uint8 severity, uint64 expiresAtBlock,
///                                      string label)
///         kind 3 fx:        abi.encode(bytes32 currencyCode, uint256 perUsdE8, uint64 asOf)
///         `asOf` (ICR-005) is the workflow's trigger time; it is stored as `updatedAt`. Stale reports revert:
///         kinds 1 and 3 through the shared freshness check, kind 2 when it has already expired.
contract SignalOracle is ReceiverBase {
    uint8 public constant KIND_REFERENCE = 1;
    uint8 public constant KIND_SIGNAL = 2;
    uint8 public constant KIND_FX = 3;

    struct Reference {
        uint256 perUnit;
        bytes32 currencyCode;
        bytes32 sourceTag;
        uint64 updatedAt;
    }

    struct Fx {
        uint256 perUsdE8;
        uint64 updatedAt;
    }

    mapping(bytes32 commodity => mapping(bytes32 market => Reference)) internal _refs;
    mapping(bytes32 currencyCode => Fx) internal _fx;
    uint256 public signalCount;

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

    error UnknownKind(uint8 kind);
    error ZeroValue();
    error EmptyKey();
    error SignalExpired(uint64 expiresAtBlock, uint256 blockNumber);

    constructor(address admin, address forwarder_) ReceiverBase(admin, forwarder_) {}

    function _processReport(bytes calldata report) internal override {
        (uint8 kind, bytes memory body) = abi.decode(report, (uint8, bytes));
        if (kind == KIND_REFERENCE) _reference(body);
        else if (kind == KIND_SIGNAL) _signal(body);
        else if (kind == KIND_FX) _fxRate(body);
        else revert UnknownKind(kind);
    }

    function _reference(bytes memory body) internal {
        (bytes32 commodity, bytes32 market, uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 asOf) =
            abi.decode(body, (bytes32, bytes32, uint256, bytes32, bytes32, uint64));
        if (commodity == 0 || market == 0 || currencyCode == 0) revert EmptyKey();
        if (perUnit == 0) revert ZeroValue();
        Reference storage r = _refs[commodity][market];
        _checkFresh(asOf, r.updatedAt);
        r.perUnit = perUnit;
        r.currencyCode = currencyCode;
        r.sourceTag = sourceTag;
        r.updatedAt = asOf;
        emit ReferencePriceUpdated(commodity, market, perUnit, currencyCode, sourceTag, asOf);
    }

    function _signal(bytes memory body) internal {
        (bytes32 signalKind, bytes32 place, uint8 severity, uint64 expiresAtBlock, string memory label) =
            abi.decode(body, (bytes32, bytes32, uint8, uint64, string));
        if (signalKind == 0 || place == 0) revert EmptyKey();
        if (expiresAtBlock <= block.number) revert SignalExpired(expiresAtBlock, block.number);
        emit DemandSignal(++signalCount, signalKind, place, severity, expiresAtBlock, label);
    }

    function _fxRate(bytes memory body) internal {
        (bytes32 currencyCode, uint256 perUsdE8, uint64 asOf) = abi.decode(body, (bytes32, uint256, uint64));
        if (currencyCode == 0) revert EmptyKey();
        if (perUsdE8 == 0) revert ZeroValue();
        Fx storage f = _fx[currencyCode];
        _checkFresh(asOf, f.updatedAt);
        f.perUsdE8 = perUsdE8;
        f.updatedAt = asOf;
        emit FxUpdated(currencyCode, perUsdE8, asOf);
    }

    // ------------------------------------------------------------------ views (contract 7.7)

    function referencePrice(bytes32 commodity, bytes32 market)
        external
        view
        returns (uint256 perUnit, bytes32 currencyCode, bytes32 sourceTag, uint64 updatedAt)
    {
        Reference storage r = _refs[commodity][market];
        return (r.perUnit, r.currencyCode, r.sourceTag, r.updatedAt);
    }

    function fxRate(bytes32 currencyCode) external view returns (uint256 perUsdE8, uint64 updatedAt) {
        Fx storage f = _fx[currencyCode];
        return (f.perUsdE8, f.updatedAt);
    }
}
