# Docs claims ledger

Every factual claim in the in-app docs (`app/src/docs/pages.tsx`, served at `/#/docs`) has a row here. A claim without a source does not go in the docs. If the code and this file disagree, the code wins and this file is fixed.

Checked 28 November 2026.

## What is Bulkhead?

| Claim | Source |
| :--- | :--- |
| Everyday has a limit per payment and per day | `contracts/contracts/BulkheadAccount.sol` (`Policy.perTxCap`, `periodCap`), `spend` |
| The laptop can never spend Savings below the amount you keep | `BulkheadAccount.sol` (`Policy.floor`, checked in `spend`) |
| The bill agent has its own account, 10 a payment and 25 a day, approved payees only | `app/server/agentKey.ts` (`RULE`, `spendingRule`), `app/server/policy.ts` |
| The Hull screen shows "the most anyone could take right now" | `app/src/screens/Hull.tsx`, `blastRadius()` in `BulkheadAccount.sol` |
| The laptop can only make walls smaller | `tightenPolicy` and `setLive` revert `NotTighter` (`BulkheadAccount.sol` lines 367, 407) |
| Only the phone makes walls bigger | `queueLoosen` / `executeLoosen` need a phone ML-DSA-87 signature (`BulkheadAccount.sol`), contract tests in `contracts/test` |
| The pilot never opens above what the phone signed | `setLive` reverts `AbovePolicy`; `validate` in `app/server/pilot.ts` |
| Live run: 0.25 at night, 2.50 in the daytime | Round 30, pilot tx `F7C8655D38DA4CB29F107CBDE9B071863AACF0CAF972074BB0F0B462999657FA`; demo account settings via `/api/pilot` (night 0.25, day 2.50) |
| The AI only reads the amount and the time; code decides | `planRequest` in `app/server/pilot.ts`, `app/functions/pilot.ts` |
| Nobody can change an account's rules after it's made | No admin, no proxy in `BulkheadAccount.sol` / `BulkheadFactory.sol` |
| Phone signatures are checked with `pqcVerify` and `pqcKeyStatus` | `contracts/contracts/lib/QorePrecompiles.sol` |
| The laptop acts through a short EVM window scoped to the account | `openScopedWindow` in `app/src/chain/wallet.ts` |
| The bill agent's limits are a chain spending rule | `app/server/agentKey.ts` (`spendingRule`) |

## Someone has my laptop

| Claim | Source |
| :--- | :--- |
| A payment over the live wall but inside the policy is held, nothing moves | `emit HeldByPilot` in `BulkheadAccount.sol` line 241; round 30 tx `34A669A4B970159795F06247C0E70BFA2C6F461434B8FEBEFBFCDF802FE58EF3` |
| A payment over the phone-signed walls seals the account in the same transaction | Tripwire seal in `spend`; round 22 tx `0x687fb72d…878b` (README proof table) |
| Tripwire triggers: a held payment, a laptop payment in quiet hours, 3 laptop payments within 10 minutes | `tripwire`, `BURST_COUNT = 3`, `BURST_MS` in `app/server/pilot.ts` |
| The tripwire closes every wall to zero; only a phone signature reopens it | `CLOSED` in `app/server/pilot.ts`; `approve-reopen` in `app/functions/pilot.ts` |
| Live: held just before midnight in quiet hours, tripwire about a minute later | Round 30 block times: held 14:48:26 UTC, tripwire 14:49:22 UTC, 56 seconds apart; tripwire tx `BF333A249921DFDDEDC9CE63D4DDB2079531F8A6A1C61E1974727EE8636B6AE7` |
| The tripwire runs every 5 minutes and when the app is opened | `.github/workflows/pilot-tick.yml` (`*/5 * * * *`); `tickPilot` in `app/src/screens/Pilot.tsx` |
| "I didn't ask for this" refuses and seals from the phone | `app/src/screens/Phone.tsx` (refuse, then `Seal`) |
| "Send everything to my recovery account" sends Everyday and Savings there | Break-glass sheet in `app/src/screens/Phone.tsx` |
| A recovery account must be set first, and must be another Bulkhead account | `NoRecovery`, `RecoveryNotAccount` in `BulkheadAccount.sol` line 476 |
| Unsealing is a phone-approved change that takes effect about an hour later | `Unseal` intent in `app/src/chain/requests.ts`; `LOOSEN_DELAY = "2500"` blocks at about 1.42 s in `app/src/screens/Setup.tsx` |
| Held and sealed payments return transaction code 0 | Round 22 and round 30 receipts; README "Common errors" |
