# AI usage

Bulkhead is built with AI tools, as the AI-Native award asks us to document. This page says what each tool did, what the owner did, and where the model is kept away from decisions.

## Building Bulkhead

| Tool | What it did |
|---|---|
| Claude Code, Claude Opus as the lead | Testnet spikes, design, all four contract versions and their tests, the relayer, pilot and agent services, app code, and every review |
| Claude Opus subagents, led by the lead | Security-sensitive pieces built to the lead's spec: the pilot schedule guard (phone signature checked on chain), the pilot tripwire, the threat model |
| Claude Sonnet subagents, led by the lead | The pending-changes panel, the v4 app wiring, the mobile layout pass, the README draft, screenshots and Activity |
| Claude Haiku subagents, led by the lead | Early test scaffolding, UI screens, scripts and docs |

Every subagent's work went to its own branch and was reviewed by the lead before a pull request. The lead re-ran the tests, re-checked addresses and hashes against the chain, and fixed what review found (for example, a pending-changes panel that reloaded on every render).

## Inside the product, at runtime

Claude Haiku, reached through SERV, does two jobs. Both are reading jobs.

| Where | What the model does | What decides |
|---|---|---|
| Bill agent (`app/server/agent.ts`) | Reads an invoice into payee, amount and token | `decide()` in `app/server/policy.ts`, then the chain's spending rule on the agent account (10 fUSD a payment, 25 a day) |
| Pilot (`app/functions/pilot.ts`) | Reads "about 12 until 18:00" into an amount and a time | `planRequest()` in `app/server/pilot.ts`, then the contract (`setLive` can never exceed the phone-signed policy) |

The model never chooses a number, an address or whether to pay. Invoice text is treated as untrusted data, so instructions hidden in an invoice change nothing.

## What the owner did

Product direction and the idea of the pilot after reviewing the other entries; every design decision and the design system; the logo; testing on a real phone, including pairing, account creation, the agent top-up and the phone seal; UX review that drove the journey, mobile and README rewrites; the demo video and the project page.

No external audit has been done yet. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for what is and isn't covered.

## Guardrails on AI-written code

- Contracts and anything that checks a signature are written or reviewed line by line by the lead, and covered by tests (69 contract tests).
- Money decisions in the agent and the pilot are deterministic code with unit tests, never the model.
- Every claim about the chain in the README and DEPLOYMENTS.md links to a real testnet transaction.

The full spike record that informed the design lives in [CryptoZephyr/qorex-spike](https://github.com/CryptoZephyr/qorex-spike).
