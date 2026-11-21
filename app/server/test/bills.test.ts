import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { empty, addBill, removeBill, dueBills, approvedPayees, spentToday, handledKeys, billKey, record, approvalFromReceipt, changeMessage, BadBill } from "../bills.js";

const ACCT = "0x" + "a".repeat(40), PAYEE = "0x" + "b".repeat(40), FUSD = "0x97143b771d34ddb9130b807b135ae675a5a963ca";
const NOV20 = Date.UTC(2026, 10, 20, 12);
const abi = parseAbi(["event Spent(address indexed asset, address indexed to, uint256 amount, bool withApproval)"]);
const spentLog = (emitter: string, to: string, withApproval: boolean) => ({
  address: emitter,
  topics: encodeEventTopics({ abi, eventName: "Spent", args: { asset: FUSD as `0x${string}`, to: to as `0x${string}` } }) as `0x${string}`[],
  data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }], [5_000_000n, withApproval]),
});

test("addBill validates every field", () => {
  const b = empty(ACCT);
  assert.throws(() => addBill(b, { name: "", payee: PAYEE, amount: "1", dueDay: 1 }), BadBill);
  assert.throws(() => addBill(b, { name: "Rent", payee: "nope", amount: "1", dueDay: 1 }), BadBill);
  assert.throws(() => addBill(b, { name: "Rent", payee: ACCT, amount: "1", dueDay: 1 }), BadBill);
  assert.throws(() => addBill(b, { name: "Rent", payee: PAYEE, amount: "0", dueDay: 1 }), BadBill);
  assert.throws(() => addBill(b, { name: "Rent", payee: PAYEE, amount: "1", dueDay: 29 }), BadBill);
  const bill = addBill(b, { name: "Phone", payee: PAYEE.toUpperCase().replace("0X", "0x"), amount: "5000000", dueDay: 3 });
  assert.equal(bill.payee, PAYEE);
  removeBill(b, bill.id);
  assert.equal(b.bills.length, 0);
});

test("a bill is only due once approved, on or after its day, and once a month", () => {
  const b = empty(ACCT);
  const bill = addBill(b, { name: "Phone", payee: PAYEE, amount: "5000000", dueDay: 3 });
  assert.deepEqual(dueBills(b, NOV20), []);
  assert.deepEqual(approvedPayees(b), {});
  bill.approvedTx = "0x" + "1".repeat(64);
  assert.deepEqual(dueBills(b, Date.UTC(2026, 10, 2)), []);
  assert.equal(dueBills(b, NOV20).length, 1);
  record(b, { key: billKey(bill, NOV20), billId: bill.id, source: "bill", label: "Phone", amount: bill.amount, decision: "pay", reason: "ok" }, NOV20);
  assert.deepEqual(dueBills(b, NOV20 + 3600_000), []);
  assert.equal(dueBills(b, Date.UTC(2026, 11, 3, 12)).length, 1);
  assert.equal(spentToday(b, NOV20), 5_000_000n);
  assert.equal(spentToday(b, NOV20 + 86_400_000), 0n);
  assert.ok(handledKeys(b).has(billKey(bill, NOV20)));
});

test("an approval counts only if the account itself paid that payee with the phone", () => {
  const b = empty(ACCT);
  const bill = addBill(b, { name: "Phone", payee: PAYEE, amount: "5000000", dueDay: 3 });
  assert.equal(approvalFromReceipt(b, bill, FUSD, [spentLog(ACCT, PAYEE, true)]), true);
  assert.equal(approvalFromReceipt(b, bill, FUSD, [spentLog(ACCT, PAYEE, false)]), false, "a laptop-only spend is not an approval");
  assert.equal(approvalFromReceipt(b, bill, FUSD, [spentLog("0x" + "c".repeat(40), PAYEE, true)]), false, "another contract's event");
  assert.equal(approvalFromReceipt(b, bill, FUSD, [spentLog(ACCT, "0x" + "d".repeat(40), true)]), false, "another payee");
});

test("the signed message binds the account, time and change", () => {
  assert.notEqual(changeMessage(ACCT, { kind: "remove", id: "1" }, 1), changeMessage(ACCT, { kind: "remove", id: "2" }, 1));
  assert.notEqual(changeMessage(ACCT, { kind: "run" }, 1), changeMessage(ACCT, { kind: "run" }, 2));
});
