// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Stub oracles for the v1 deployment (S1 1.4)
/// @notice Placeholders so deployments/<network>.json has valid SignalOracle and DisputeResolver addresses before
///         S1 4.1 builds the real CRE receivers. Every call reverts. Nothing holds privileges for these addresses:
///         LotFactory and MarketSettlement are deployed with resolver = address(0) in v1 (D-48).
abstract contract RevertingStub {
    error NotImplemented();

    fallback() external payable {
        revert NotImplemented();
    }
}

contract StubSignalOracle is RevertingStub {}

contract StubDisputeResolver is RevertingStub {}
