# Testnet deployments (qorechain-diana, EVM chain id 9800)

| Contract | Address | From |
|---|---|---|
| BulkheadFactory (current) | 0x3df113cf4a7ddb5d22eed33f8de430d531026355 | phase-1-contracts 6c7778a |
| BulkheadAccount (live parity, current) | 0x7C66b7D53EB9F4692000d3578eAd5a1385e359Be | deployed by the factory with a real ML-DSA-87 signature |
| BulkheadFactory (superseded) | 0x72d28d81edbd8109689620fc73a843d41990b843 | 4668175, before the refilling allowance and sentinel fixes |

Live parity results, 21 November (rerun on the current contracts gave the same outcomes, gas within 1%):

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

## Agent compartment, live (21 November)

| Item | Value |
|---|---|
| Bulkhead account with fUSD policy | 0x1c548456DE8683d816409eceBd19D3C4BAD75a5E |
| fUSD (fest token) | 0x97143B771D34ddb9130b807b135Ae675A5a963CA, 6 decimals |
| Token funding | MsgConvertCoin, 100 fUSD bank coins to the account's ERC-20 balance |
| Agent account rule | fUSD only, 10 per payment, 25 per day, only fUSD.transfer |
| Phone top-up | spendWithApproval 30 fUSD, real ML-DSA-87 |

| Agent action | Result |
|---|---|
| Pay 8 fUSD | paid |
| Pay 15 fUSD, over 10 per payment | blocked by the chain |
| Pay 9 fUSD, 17 today | paid |
| Pay 9 fUSD, 26 today, over 25 per day | blocked by the chain |
| Hijacked key calls Bulkhead.spend directly | blocked by the chain |

Final balances: payee 17, agent account 13, Bulkhead 70 fUSD (untouched by the agent).
