import { network } from "hardhat";
import { encodeAbiParameters, keccak256, parseEther, toHex, type Address, type Hex } from "viem";

export const VERIFY = "0x0000000000000000000000000000000000000a01" as Address;
export const KEY_STATUS = "0x0000000000000000000000000000000000000a02" as Address;
export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;
export const PQ_PUBKEY = toHex(new Uint8Array(2592).fill(7));

export type Policy = { perTxCap: bigint; periodCap: bigint; floor: bigint };

/// Fresh chain with MockPQC placed at both precompile addresses.
export async function setup() {
  const conn = await network.create();
  const { viem, networkHelpers } = conn;
  const [everyday, safety, relayer, stranger, sentinel, payee] = await viem.getWalletClients();
  const mock = await viem.deployContract("MockPQC");
  const code = await (await viem.getPublicClient()).getCode({ address: mock.address });
  await networkHelpers.setCode(VERIFY, code!);
  await networkHelpers.setCode(KEY_STATUS, code!);
  const verify = await viem.getContractAt("MockPQC", VERIFY);
  const keys = await viem.getContractAt("MockPQC", KEY_STATUS);
  await keys.write.setKey([safety.account.address, PQ_PUBKEY, true]);
  const factory = await viem.deployContract("BulkheadFactory");
  const pub = await viem.getPublicClient();
  return { conn, viem, networkHelpers, pub, everyday, safety, relayer, stranger, sentinel, payee, verify, keys, factory };
}

export type Env = Awaited<ReturnType<typeof setup>>;

/// A "signature" the mock accepts for exactly this message.
export async function approve(env: Env, message: Hex): Promise<Hex> {
  const sig = keccak256(message);
  await env.verify.write.markValid([PQ_PUBKEY, sig, message]);
  return sig;
}

export const defaultPolicy: Policy = { perTxCap: parseEther("1"), periodCap: parseEther("3"), floor: parseEther("5") };

export async function deployAccount(env: Env, over: Partial<{ recovery: Address; payees: Address[]; policy: Policy; assets: Address[]; delay: bigint }> = {}) {
  const assets = over.assets ?? [NATIVE];
  const init = {
    everyday: env.everyday.account.address,
    safety: env.safety.account.address,
    recovery: over.recovery ?? NATIVE,
    periodBlocks: 100n,
    loosenDelay: over.delay ?? 50n,
    safetyDelay: 200n,
    assets,
    policies: assets.map(() => over.policy ?? defaultPolicy),
    payees: over.payees ?? [],
  };
  const salt = keccak256(toHex(`salt-${Math.random()}`));
  const d = await env.factory.read.digest([init, salt]);
  const sig = await approve(env, d);
  const addr = await env.factory.read.predict([init, salt]);
  await env.factory.write.deploy([init, salt, sig], { account: env.relayer.account });
  return { account: await env.viem.getContractAt("BulkheadAccount", addr), init };
}

export const encode = encodeAbiParameters;
export const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 365);
