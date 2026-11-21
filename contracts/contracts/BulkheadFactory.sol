// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QorePQC} from "./lib/QorePrecompiles.sol";
import {BulkheadAccount} from "./BulkheadAccount.sol";

/// @title BulkheadFactory
/// @notice Deploys Bulkhead accounts through any relayer. A deployment needs a valid ML-DSA-87
///         signature from the account's Safety key over every parameter, and that key must be
///         registered and proven on chain. `isAccount` lets accounts require that a recovery
///         destination is another Bulkhead account, so it cannot share a stolen seed.
contract BulkheadFactory {
    bytes32 public constant TAG = keccak256("BULKHEAD_DEPLOY_V1");

    mapping(address => bool) public isAccount;

    event Deployed(address indexed account, address indexed everyday, address indexed safety);

    error NoSafetyKey();
    error SafetyKeyNotProven();
    error BadSafetySignature();
    error RecoveryNotAccount();
    error BadInit();

    function digest(BulkheadAccount.Init calldata i, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(TAG, block.chainid, address(this), keccak256(abi.encode(i)), salt));
    }

    function predict(BulkheadAccount.Init calldata i, bytes32 salt) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(i, salt),
            keccak256(abi.encodePacked(type(BulkheadAccount).creationCode, abi.encode(i)))));
        return address(uint160(uint256(h)));
    }

    function deploy(BulkheadAccount.Init calldata i, bytes32 salt, bytes calldata sig) external returns (address account) {
        if (i.everyday == address(0) || i.safety == address(0) || i.everyday == i.safety) revert BadInit();
        if (i.periodBlocks == 0 || i.assets.length != i.policies.length) revert BadInit();
        if (i.recovery != address(0) && !isAccount[i.recovery]) revert RecoveryNotAccount();
        (bool registered, , bytes memory pk, bool proven) = QorePQC.keyOf(i.safety);
        if (!registered || pk.length == 0) revert NoSafetyKey();
        if (!proven) revert SafetyKeyNotProven();
        if (!QorePQC.verify(pk, sig, abi.encodePacked(digest(i, salt)))) revert BadSafetySignature();
        account = address(new BulkheadAccount{salt: _salt(i, salt)}(i));
        isAccount[account] = true;
        emit Deployed(account, i.everyday, i.safety);
    }

    function _salt(BulkheadAccount.Init calldata i, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(i.everyday, i.safety, salt));
    }
}
