# Testnet deployments (qorechain-diana, EVM chain id 9800)

| Contract | Address | From |
|---|---|---|
| BulkheadFactory | 0x72d28d81edbd8109689620fc73a843d41990b843 | phase-1-contracts b255d55 |
| BulkheadAccount (live parity) | 0x2E211aF58C9cd467354bB9432d8cc5483AC562Ce | deployed by the factory with a real ML-DSA-87 signature |

Live parity results, 21 November:

| Step | Result | Gas |
|---|---|---|
| Deploy factory | OK | 3,309,254 |
| Deploy with a forged Safety-key signature | refused, BadSafetySignature | |
| Deploy with a real ML-DSA-87 signature, relayed | OK | 2,429,748 |
| Native-lane funding, no window | arrived | |
| Everyday spend within walls, window scoped to the account | OK | 119,679 |
| Everyday spend over the per-tx cap | tx success, sealed, nothing moved | 109,061 |
| spendWithApproval with a forged signature | refused | |
| spendWithApproval below the floor while sealed, real ML-DSA-87 | OK | billed 1,500,000 (half the limit, the chain's floor) |
