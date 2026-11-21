// The bill agent's money decisions. Deterministic code, never the model.
// The model only extracts fields from an invoice and proposes an action. This function decides.
// The chain's spending rule on the agent account is the backstop: even if this code were wrong,
// the chain caps every payment per transaction and per day (measured, spike round 21).

export interface Rule {
  /** Token the agent may pay in (lowercase 0x address). */
  token: string;
  /** Base units. */
  perPayment: bigint;
  perDay: bigint;
  /** Approved payees: lowercase 0x address -> display name. */
  payees: Record<string, string>;
}

export interface Proposal {
  invoiceId: string;
  /** As read from the invoice by the model. Untrusted. */
  payee: string;
  amount: bigint;
  token: string;
}

export type Verdict =
  | { decision: "pay"; reason: string }
  | { decision: "ask-phone"; reason: string }
  | { decision: "reject"; reason: string };

const ADDRESS = /^0x[0-9a-f]{40}$/;

export function decide(rule: Rule, p: Proposal, spentToday: bigint, alreadyHandled: Set<string>, fmt: (n: bigint) => string): Verdict {
  const payee = p.payee.toLowerCase();
  const token = p.token.toLowerCase();
  if (!p.invoiceId || alreadyHandled.has(p.invoiceId)) return { decision: "reject", reason: "This invoice was already handled." };
  if (!ADDRESS.test(payee)) return { decision: "reject", reason: "The payee is not a valid address." };
  if (token !== rule.token.toLowerCase()) return { decision: "reject", reason: "The invoice asks for a token the agent may not pay in." };
  if (p.amount <= 0n) return { decision: "reject", reason: "The amount must be more than zero." };
  const name = rule.payees[payee];
  if (!name) return { decision: "ask-phone", reason: `Unknown payee ${payee}, so it needs your phone.` };
  if (p.amount > rule.perPayment) return { decision: "ask-phone", reason: `${fmt(p.amount)} is over ${fmt(rule.perPayment)} per payment, so it needs your phone.` };
  if (spentToday + p.amount > rule.perDay) return { decision: "ask-phone", reason: `Paying ${fmt(p.amount)} would make ${fmt(spentToday + p.amount)} today, over ${fmt(rule.perDay)} a day, so it needs your phone.` };
  return { decision: "pay", reason: `Approved payee ${name}, ${fmt(p.amount)} is within ${fmt(rule.perPayment)} per payment and ${fmt(rule.perDay)} a day.` };
}
