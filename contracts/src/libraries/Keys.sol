// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Keys
/// @notice Sector keys, encoded like `toKey()` in @fairtown/shared/keys: `stringToHex(s, { size: 32 })`,
///         i.e. ASCII left-aligned and zero-padded on the right, which is exactly a Solidity `bytes32("...")` literal.
library Keys {
    bytes32 internal constant PRODUCE = "produce";
    bytes32 internal constant FISH = "fish";
    bytes32 internal constant FLOWERS = "flowers";
    bytes32 internal constant TRUCK = "truck";
    bytes32 internal constant STORAGE = "storage";
    bytes32 internal constant COMPUTE = "compute";

    /// @notice Contract 7.6: `TransportNeeded` fires for produce, fish and flowers only.
    function needsTransport(bytes32 sector) internal pure returns (bool) {
        return sector == PRODUCE || sector == FISH || sector == FLOWERS;
    }

    function isTruck(bytes32 sector) internal pure returns (bool) {
        return sector == TRUCK;
    }

    function isSector(bytes32 sector) internal pure returns (bool) {
        return sector == PRODUCE || sector == FISH || sector == FLOWERS || sector == TRUCK || sector == STORAGE
            || sector == COMPUTE;
    }
}
