// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Stands in for 0x0A01 pqcVerify and 0x0A02 pqcKeyStatus. It does not do lattice maths. A test
/// declares which (pubkey, signature, message) triples count as valid. Real verification is covered
/// by scripts/live-parity.mjs, which runs the same cases against the testnet precompiles.
contract MockPQC {
    mapping(address => bytes) internal keys;
    mapping(address => bool) internal provenKey;
    mapping(bytes32 => bool) internal valid;

    function setKey(address account, bytes calldata pubkey, bool proven) external {
        keys[account] = pubkey;
        provenKey[account] = proven;
    }
    function markValid(bytes calldata pubkey, bytes calldata sig, bytes calldata message) external {
        valid[keccak256(abi.encode(pubkey, sig, message))] = true;
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata sig, bytes calldata message) external view returns (bool) {
        return valid[keccak256(abi.encode(pubkey, sig, message))];
    }

    function pqcKeyStatus(address account) external view returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool proven) {
        pubkey = keys[account];
        registered = pubkey.length != 0;
        algorithmId = registered ? 1 : 0;
        proven = provenKey[account];
    }
}
