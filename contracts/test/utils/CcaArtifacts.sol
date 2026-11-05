// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Import-only: makes forge build the CCA factory artifact (via_ir, per foundry.toml compilation_restrictions)
// so tests can vm.deployCode it without pulling the via_ir pipeline into every test file. Never copy CCA source.
import {ContinuousClearingAuctionFactory} from "continuous-clearing-auction/ContinuousClearingAuctionFactory.sol";
