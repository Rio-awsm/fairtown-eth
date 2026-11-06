// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ValidationHookIntrospection
} from "continuous-clearing-auction/periphery/validationHooks/ValidationHookIntrospection.sol";
import {IAgentRegistry} from "./AgentRegistry.sol";

/// @title AgentRegistryHook
/// @notice CCA validation hook (contract section 7.3). A bid passes only if the account that called
///         `submitBid` is the bid owner and that owner may bid. CCA passes `msg.sender` as `sender`
///         (ContinuousClearingAuction.sol `_submitBid`), so a router cannot bid on someone's behalf.
contract AgentRegistryHook is ValidationHookIntrospection {
    IAgentRegistry public immutable registry;

    error ZeroAddress();
    error SenderNotOwner(address sender, address owner);
    error NotABidder(address owner);

    constructor(IAgentRegistry registry_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    function validate(uint256, uint128, address owner, address sender, bytes calldata) external view override {
        if (sender != owner) revert SenderNotOwner(sender, owner);
        if (!registry.canBid(owner)) revert NotABidder(owner);
    }
}
