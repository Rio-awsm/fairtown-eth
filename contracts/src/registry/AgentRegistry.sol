// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IAgentRegistry {
    function roleOf(address agent) external view returns (uint8);
    function canBid(address agent) external view returns (bool);
    function canList(address agent) external view returns (bool);
}

/// @title AgentRegistry
/// @notice Who may bid and who may list. Contract section 7.2. Roles mirror `ROLES` in @fairtown/shared/keys.
contract AgentRegistry is IAgentRegistry, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint8 public constant NONE = 0;
    uint8 public constant SELLER = 1;
    uint8 public constant BUYER = 2;
    uint8 public constant TRUCK = 3;
    uint8 public constant STORAGE = 4;
    uint8 public constant SOCIETY = 5;
    uint8 public constant HUMAN = 6;
    uint8 public constant MAX_ROLE = HUMAN;

    struct Agent {
        bool registered;
        uint8 role;
        string name;
    }

    mapping(address agent => Agent) internal _agents;

    event AgentRegistered(address indexed agent, uint8 role, string name);

    error ZeroAddress();
    error InvalidRole(uint8 role);
    error AlreadyRegistered(address agent);
    error NotRegistered(address agent);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function register(address agent, uint8 role, string calldata name) external onlyRole(OPERATOR_ROLE) {
        if (agent == address(0)) revert ZeroAddress();
        if (role == NONE || role > MAX_ROLE) revert InvalidRole(role);
        if (_agents[agent].registered) revert AlreadyRegistered(agent);
        _agents[agent] = Agent({registered: true, role: role, name: name});
        emit AgentRegistered(agent, role, name);
    }

    /// @notice Change or revoke (NONE) a role. Re-emits `AgentRegistered` so indexers see the new role.
    function setRole(address agent, uint8 role) external onlyRole(OPERATOR_ROLE) {
        Agent storage a = _agents[agent];
        if (!a.registered) revert NotRegistered(agent);
        if (role > MAX_ROLE) revert InvalidRole(role);
        a.role = role;
        emit AgentRegistered(agent, role, a.name);
    }

    function roleOf(address agent) public view returns (uint8) {
        return _agents[agent].role;
    }

    function nameOf(address agent) external view returns (string memory) {
        return _agents[agent].name;
    }

    function canBid(address agent) external view returns (bool) {
        uint8 r = roleOf(agent);
        return r == BUYER || r == SOCIETY || r == HUMAN;
    }

    function canList(address agent) external view returns (bool) {
        uint8 r = roleOf(agent);
        return r == SELLER || r == TRUCK || r == STORAGE;
    }
}
