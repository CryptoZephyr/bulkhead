import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, type Abi, type AbiParameter, type Address, type Hex } from "viem";
import accountAbiJson from "../../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import factoryAbiJson from "../../src/chain/abi/BulkheadFactory.json" with { type: "json" };
import { classify, Refused, ACCOUNT_CALLS } from "../relayer.js";

const accountAbi = accountAbiJson as Abi, factoryAbi = factoryAbiJson as Abi;
const ACCOUNT = "0x1c548456DE8683d816409eceBd19D3C4BAD75a5E" as Address;
const STRANGER = "0x" + "22".repeat(20) as Address;
const FACTORY = "0x" + "fa".repeat(20) as Address;
const isAccount = async (a: Address) => a.toLowerCase() === ACCOUNT.toLowerCase();

/** A placeholder value of each ABI type, so any function can be encoded. */
function dummy(p: AbiParameter): unknown {
  if (p.type.endsWith("[]")) return [];
  if (p.type === "tuple") return Object.fromEntries((p as { components: readonly AbiParameter[] }).components.map((c) => [c.name, dummy(c)]));
  if (p.type === "address") return ACCOUNT;
  if (p.type === "bool") return false;
  if (p.type === "bytes") return "0x";
  if (p.type === "string") return "";
  if (/^bytes\d+$/.test(p.type)) return "0x" + "00".repeat(Number(p.type.slice(5)));
  if (/^u?int\d*$/.test(p.type)) return 0n;
  throw new Error(`no dummy for ${p.type}`);
}
function call(abi: Abi, name: string): Hex {
  const f = abi.find((x) => x.type === "function" && x.name === name) as { inputs: readonly AbiParameter[] } | undefined;
  assert.ok(f, `${name} is in the ABI`);
  return encodeFunctionData({ abi, functionName: name, args: f.inputs.map(dummy) } as never);
}

test("every allowed account call passes", async () => {
  assert.ok(ACCOUNT_CALLS.size > 0);
  for (const fn of ACCOUNT_CALLS) assert.equal(await classify(ACCOUNT, call(accountAbi, fn), FACTORY, isAccount), fn);
});

test("the owner-only account calls are refused", async () => {
  for (const fn of ["spend", "seal", "tightenPolicy", "setLive", "removePilot"]) {
    await assert.rejects(() => classify(ACCOUNT, call(accountAbi, fn), FACTORY, isAccount), (e: unknown) => e instanceof Refused && new RegExp(`doesn't send ${fn}`).test((e as Error).message), fn);
  }
});

test("a target that isn't a Bulkhead account is refused", async () => {
  await assert.rejects(() => classify(STRANGER, call(accountAbi, "spendWithApproval"), FACTORY, isAccount), /not a Bulkhead account/);
});

test("the factory's deploy passes; its other calls are refused", async () => {
  assert.equal(await classify(FACTORY, call(factoryAbi, "deploy"), FACTORY, isAccount), "deploy");
  assert.equal(await classify(FACTORY.toUpperCase().replace("0X", "0x") as Address, call(factoryAbi, "deploy"), FACTORY, isAccount), "deploy");
  for (const fn of ["predict", "isAccount", "digest"]) await assert.rejects(() => classify(FACTORY, call(factoryAbi, fn), FACTORY, isAccount), Refused, fn);
});

test("garbage calldata is refused", async () => {
  for (const data of ["0x", "0xdeadbeef", ("0x" + "ff".repeat(68)) as Hex] as Hex[]) {
    await assert.rejects(() => classify(ACCOUNT, data, FACTORY, isAccount), Refused, `account ${data}`);
    await assert.rejects(() => classify(FACTORY, data, FACTORY, isAccount), Refused, `factory ${data}`);
  }
});
