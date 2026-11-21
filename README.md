# Bulkhead

Watertight walls inside your money. Only the post-quantum key on your phone can move a wall.

Bulkhead is damage-bounded money for everyday people on QoreChain. Funds sit in three compartments, each with its own blast radius. A stolen laptop, a hijacked AI agent or a phished key can only flood one compartment, and the most anyone can lose is fixed in advance and enforced by the chain.

Entry for QoreChain Build Before Q-Day, Post-Quantum dApp track. Build in progress.

## Repository

| Path | What |
|---|---|
| `contracts/` | Solidity contracts and Hardhat 3 tests |
| `app/` | Laptop app and phone safety view (coming) |
| `server/` | Gateway, relayer, bill agent, approval queue (coming) |
| `docs/` | Threat model, audits, architecture |

## Run the contract tests

```bash
cd contracts && npm ci && npm test
```

Licence: MIT, see LICENSE. AI use: see AI_USAGE.md.
