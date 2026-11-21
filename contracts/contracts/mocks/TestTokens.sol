// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal ERC-20 for tests.
contract TestToken {
    mapping(address => uint256) public balanceOf;
    constructor(address to, uint256 amount) { balanceOf[to] = amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// ERC-20 that returns nothing from transfer, like USDT.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    constructor(address to, uint256 amount) { balanceOf[to] = amount; }
    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

/// Stands in for a precompile that is inactive: every call succeeds and returns nothing.
contract MockInactive {
    fallback() external {}
}
