// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Thrown when a QoreChain precompile answers with empty data. On the live testnet an inactive
/// precompile does NOT revert, it succeeds and returns nothing, so unchecked callers read zeros.
error PrecompileInactive(address precompile);

/// Cross-VM bridge, EVM -> CosmWasm (precompile 0x0901).
/// Revert data from the bridge is passed through untouched, so the caller sees the real reason
/// ("... is not allowlisted", or the CosmWasm contract's own error).
library QoreCrossVM {
    address internal constant BRIDGE = address(uint160(0x0901));
    uint8 internal constant TARGET_NATIVE = 1;

    /// The bridge answers with the target's response ABI-encoded as `bytes` (measured on testnet:
    /// a cw20 call with no response data comes back as 0x20, 0x00, 64 bytes). An empty answer means
    /// the precompile is inactive. This returns the decoded response, which may legitimately be empty.
    function callNative(string memory target, bytes memory payload) internal returns (bytes memory ret) {
        (bool ok, bytes memory raw) = BRIDGE.call(abi.encodeWithSignature(
            "executeCrossVMCall(uint8,string,bytes)", TARGET_NATIVE, target, payload));
        if (!ok) { assembly { revert(add(raw, 32), mload(raw)) } }
        if (raw.length == 0) revert PrecompileInactive(BRIDGE);
        ret = abi.decode(raw, (bytes));
    }
}

/// Post-quantum helpers (precompiles 0x0A01 pqcVerify and 0x0A02 pqcKeyStatus).
library QorePQC {
    address internal constant VERIFY = address(uint160(0x0A01));
    address internal constant KEY_STATUS = address(uint160(0x0A02));

    function verify(bytes memory pubkey, bytes memory sig, bytes memory message) internal view returns (bool) {
        (bool ok, bytes memory r) = VERIFY.staticcall(abi.encodeWithSignature(
            "pqcVerify(bytes,bytes,bytes)", pubkey, sig, message));
        if (!ok || r.length != 32) revert PrecompileInactive(VERIFY);
        return abi.decode(r, (bool));
    }

    /// The live precompile returns FOUR values. The SDK ABI lists three and drops `proven`, which says
    /// whether the account proved it holds the key's secret when it registered. An unproven key may
    /// belong to someone else, so callers that trust a key must check `proven`.
    function keyOf(address account)
        internal view returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool proven)
    {
        (bool ok, bytes memory r) = KEY_STATUS.staticcall(abi.encodeWithSignature("pqcKeyStatus(address)", account));
        if (!ok || r.length == 0) revert PrecompileInactive(KEY_STATUS);
        (registered, algorithmId, pubkey, proven) = abi.decode(r, (bool, uint8, bytes, bool));
    }
}
