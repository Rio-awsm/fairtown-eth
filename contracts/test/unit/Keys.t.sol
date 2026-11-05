// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Keys} from "../../src/libraries/Keys.sol";

contract KeysTest is Test {
    /// toKey("fish") = stringToHex("fish", { size: 32 }) = 0x66697368 followed by 28 zero bytes.
    function test_encodingMatchesSharedToKey() public pure {
        assertEq(Keys.FISH, bytes32(hex"66697368"));
        assertEq(Keys.PRODUCE, bytes32(bytes("produce")));
        assertEq(Keys.FLOWERS, bytes32(bytes("flowers")));
        assertEq(Keys.TRUCK, bytes32(bytes("truck")));
        assertEq(Keys.STORAGE, bytes32(bytes("storage")));
        assertEq(Keys.COMPUTE, bytes32(bytes("compute")));
    }

    function test_needsTransport() public pure {
        assertTrue(Keys.needsTransport(Keys.PRODUCE));
        assertTrue(Keys.needsTransport(Keys.FISH));
        assertTrue(Keys.needsTransport(Keys.FLOWERS));
        assertFalse(Keys.needsTransport(Keys.TRUCK));
        assertFalse(Keys.needsTransport(Keys.STORAGE));
        assertFalse(Keys.needsTransport(Keys.COMPUTE));
        assertFalse(Keys.needsTransport(bytes32(0)));
        assertFalse(Keys.needsTransport("Fish"), "keys are lowercase");
    }

    function test_isTruckAndIsSector() public pure {
        assertTrue(Keys.isTruck(Keys.TRUCK));
        assertFalse(Keys.isTruck(Keys.FISH));
        assertTrue(Keys.isSector(Keys.COMPUTE));
        assertFalse(Keys.isSector("cod"), "commodity is not a sector");
        assertFalse(Keys.isSector(bytes32(0)));
    }
}
