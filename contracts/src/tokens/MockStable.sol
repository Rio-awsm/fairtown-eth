// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MockStable
/// @notice Testnet-only 6-decimal stablecoin (`tUSD`, `tEUR`). Contract section 7.1. Not real money.
contract MockStable is ERC20, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant DRIP_AMOUNT = 5000 * 1e6;
    uint256 public constant DRIP_INTERVAL = 24 hours;

    /// @notice Earliest timestamp at which `to` can receive the next drip.
    mapping(address to => uint256) public nextDripAt;

    error DripTooSoon(address to, uint256 nextDripAt);
    error ZeroAddress();

    constructor(string memory name_, string memory symbol_, address admin) ERC20(name_, symbol_) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        _mint(to, amount);
    }

    /// @notice Public faucet: 5,000.00 per address per 24h.
    function drip(address to) external {
        uint256 next = nextDripAt[to];
        // forge-lint: disable-next-line(block-timestamp) 24h faucet window; minutes of drift are harmless
        if (block.timestamp < next) revert DripTooSoon(to, next);
        nextDripAt[to] = block.timestamp + DRIP_INTERVAL;
        _mint(to, DRIP_AMOUNT);
    }
}
