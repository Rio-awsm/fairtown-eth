// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title LotToken
/// @notice One token per lot, 18 decimals, `qty * 1e18` minted once at creation (e.g. "Lot 12 Cod").
/// @dev Settlement burns on handover and refunds; settlement and the dispute resolver escrow buyer tokens
///      on report or dispute without a separate approval. No other privileged paths, no further minting.
contract LotToken is ERC20 {
    address public immutable settlement;
    address public immutable resolver;

    error NotSettlement(address caller);
    error NotSettlementOrResolver(address caller);
    error ZeroAddress();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply,
        address mintTo,
        address settlement_,
        // forge-lint: disable-next-line(missing-zero-check) zero is valid until DisputeResolver exists (S1 4.1)
        address resolver_
    ) ERC20(name_, symbol_) {
        if (mintTo == address(0) || settlement_ == address(0)) revert ZeroAddress();
        settlement = settlement_;
        resolver = resolver_; // address(0) until DisputeResolver exists (S1 4.1)
        _mint(mintTo, supply);
    }

    function burnFrom(address from, uint256 amount) external {
        if (msg.sender != settlement) revert NotSettlement(msg.sender);
        _burn(from, amount);
    }

    /// @notice Moves `amount` from `from` to the caller (settlement or resolver), no allowance needed.
    function escrowFrom(address from, uint256 amount) external {
        if (msg.sender != settlement && (msg.sender != resolver || resolver == address(0))) {
            revert NotSettlementOrResolver(msg.sender);
        }
        _transfer(from, msg.sender, amount);
    }
}
