// Fixed invoice sets, including a poisoned one, must give the same verdicts on every run.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, type Rule } from "../policy.js";

const FUSD = "0x97143b771d34ddb9130b807b135ae675a5a963ca";
const ACME = "0x000000000000000000000000000000000000a11c";
const DNS = "0x000000000000000000000000000000000000d115";
const THIEF = "0x000000000000000000000000000000000000dead";
const u = (n: number) => BigInt(Math.round(n * 1e6));
const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);
const rule: Rule = { token: FUSD, perPayment: u(10), perDay: u(25), payees: { [ACME]: "acme-hosting", [DNS]: "dns-registrar" } };

test("pays an approved payee within the rule", () => {
  const v = decide(rule, { invoiceId: "INV-101", payee: ACME, amount: u(8), token: FUSD }, 0n, new Set(), fmt);
  assert.equal(v.decision, "pay");
  assert.match(v.reason, /acme-hosting/);
});

test("the poisoned invoice always goes to the phone, whatever its text says", () => {
  const v = decide(rule, { invoiceId: "INV-103", payee: THIEF, amount: u(5000), token: FUSD }, 0n, new Set(), fmt);
  assert.equal(v.decision, "ask-phone");
  assert.match(v.reason, /Unknown payee/);
});

test("over the per-payment cap goes to the phone", () => {
  assert.equal(decide(rule, { invoiceId: "a", payee: ACME, amount: u(15), token: FUSD }, 0n, new Set(), fmt).decision, "ask-phone");
});

test("over the daily cap goes to the phone", () => {
  const v = decide(rule, { invoiceId: "b", payee: DNS, amount: u(9), token: FUSD }, u(17), new Set(), fmt);
  assert.equal(v.decision, "ask-phone");
  assert.match(v.reason, /26.00 today/);
});

test("a duplicate invoice is rejected", () => {
  assert.equal(decide(rule, { invoiceId: "INV-101", payee: ACME, amount: u(8), token: FUSD }, 0n, new Set(["INV-101"]), fmt).decision, "reject");
});

test("another token, a bad address or a zero amount are rejected", () => {
  assert.equal(decide(rule, { invoiceId: "c", payee: ACME, amount: u(1), token: THIEF }, 0n, new Set(), fmt).decision, "reject");
  assert.equal(decide(rule, { invoiceId: "d", payee: "acme-hosting", amount: u(1), token: FUSD }, 0n, new Set(), fmt).decision, "reject");
  assert.equal(decide(rule, { invoiceId: "e", payee: ACME, amount: 0n, token: FUSD }, 0n, new Set(), fmt).decision, "reject");
});

test("the same inputs give the same verdict every time", () => {
  const p = { invoiceId: "f", payee: DNS, amount: u(9), token: FUSD };
  const first = JSON.stringify(decide(rule, p, u(5), new Set(), fmt));
  for (let i = 0; i < 100; i++) assert.equal(JSON.stringify(decide(rule, p, u(5), new Set(), fmt)), first);
});
