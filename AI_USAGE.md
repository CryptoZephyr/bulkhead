# AI usage

Bulkhead is built with AI tools, as the AI-Native award asks us to document.

| Tool | What it did |
|---|---|
| Claude Code (Claude Opus as lead) | Testnet spikes, design, contracts, tests, backend and app code, reviews |
| Claude Haiku subagents, led by the lead | Test scaffolding, UI screens, scripts, docs, each reviewed by the lead |
| Claude Haiku through SERV Reasoning | Runtime model inside the product: the bill agent reads invoices and proposes actions |

What the human owner did: product direction, every design decision, QCAI audits, real-phone and QoreX testing, UX review, video and project page.

Guardrails on AI-written code: security-critical contracts and the agent's policy function are written by the lead model and reviewed line by line. The bill agent's money decisions are deterministic code. The model only proposes, and the chain's spending rules cap what it can do.

The full spike record that informed the design lives in CryptoZephyr/qorex-spike.
