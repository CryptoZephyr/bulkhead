# Bulkhead threat model

This document states what Bulkhead protects, who can attack it, which rules the contract enforces, and what is still open. Every claim points to code on `main`, a test in `contracts/test` or `app/server/test`, or a testnet transaction in [DEPLOYMENTS.md](DEPLOYMENTS.md). Where something is designed but not built, it is listed under residual risks.

## 1. Assets

| Asset | Where it lives | Why it matters |
| :--- | :--- | :--- |
| Everyday compartment funds | `BulkheadAccount` balance above the floor | Spendable by the laptop key, inside the walls |
| Savings compartment funds | `BulkheadAccount` balance below `policy[asset].floor` | Only a Safety-key signature moves them |
| Agent compartment funds | A separate chain account with the bill agent's linked ed25519 key | Topped up from Bulkhead only by a phone-signed `spendWithApproval` |
| The ability to widen | Safety-key signatures checked by `_checkSafety` | Whoever widens a wall controls the blast radius |
| The phone's Safety key (ML-DSA-87) | Phone browser, AES-GCM under a password (PBKDF2-SHA256, 600k iterations, `app/src/chain/device.ts`) | The only authority that widens, unseals, recovers or changes the pilot |
| The laptop key | Laptop browser, encrypted the same way (`app/src/chain/wallet.ts`) | Spends inside the walls, tightens, seals, breaks glass |
| The pilot key | Vercel environment only | Moves the live walls between zero and the phone-signed policy |
| The relayer key | Vercel environment (`RELAYER_MNEMONIC`) | Pays gas for phone-signed calls and deployments |
| The bill agent keys | Vercel environment (`AGENT_OWNER_MNEMONIC`, `AGENT_KEY_HEX`) | Pay approved bills from the Agent compartment |

## 2. Trust boundaries and actors

| Component | Trusted for | Not trusted for |
| :--- | :--- | :--- |
| Owner laptop (browser app) | Everyday spends and tightening | Any widening |
| Owner phone (safety view) | Every widening, phone-approved spend, unseal, recovery, pilot change | Nothing beyond its own signature |
| Our server: Vercel functions and Blob | Liveness of the pilot, relayer, queue and pairing relay | Reading or forging requests, moving funds |
| Relayer | Paying gas | Choosing what a phone-signed call does |
| Pilot service | Lowering walls on schedule, raising within the ceiling | Anything above the phone-signed policy |
| Bill agent | Paying approved payees from its own account | Deciding to pay; the model never decides |
| SERV model (`claude-haiku-5-5`) | Reading invoice fields and free-text pilot requests | Any money decision |
| QoreChain and its precompiles (`pqcVerify` 0x...0a01, `pqcKeyStatus` 0x...0a02) | Signature checks, window scope, spending rules | Assumed correct; an inactive precompile fails closed |

Attackers considered: a laptop thief; a phisher who gets the owner to sign; a compromised server; a compromised dependency or deployment; a hijacked agent or a prompt-injected invoice; a lost phone; a quantum adversary who can break ECDSA but not ML-DSA-87.

## 3. Core invariants

| # | Invariant | Contract function | Reverts with | Test |
| :--- | :--- | :--- | :--- | :--- |
| I1 | No everyday outflow exceeds the per-transaction cap, the period allowance or the floor. A breach seals and moves nothing | `spend` | Does not revert. Emits `Tripped` and `Sealed`, returns false | "over the per-transaction cap: trips and seals without reverting, moves nothing", "never goes below the Savings floor", "a burst across a period boundary cannot reach twice the period cap", and the I1 checks in "Invariants: randomised sequences (seeded)" |
| I2 | No laptop-key or sentinel call loosens anything | `tightenPolicy`, `setLive`, `throttle` | `NotTighter`, `ThrottleTooLong`, `ThrottleBudgetUsed` | "everyday key can tighten but not widen (I2)", "the laptop can lower the live walls but never raise them", I2 checks in the randomised sequences |
| I3 | While sealed, the everyday key moves nothing except to the pinned recovery account. Only a fresh Safety-key signature moves funds elsewhere | `spend`, `breakGlass`, `spendWithApproval` | `spend` returns false; `breakGlass` reverts `NoRecovery` without a recovery | "the everyday key can only send everything to the pinned recovery account", "moves money below the floor and works while sealed", I3 checks in the randomised sequences |
| I4 | Sentinel throttles are bounded and never move funds | `throttle` | `NotSentinel`, `ThrottleTooLong`, `ThrottleBudgetUsed` | "Sentinels (I4)" block, "throttles pause at most half of each period, once per period, and cannot cancel a queued Unseal" |
| I5 | An unregistered or unproven Safety key authorises nothing | `_checkSafety`, `BulkheadFactory.deploy`, `confirmSafety` | `NoSafetyKey`, `SafetyKeyNotProven` | "refuses an unproven Safety key (I5)", "refuses an unregistered Safety key (I5)", "only the laptop key can propose, and the new phone's key must be proven" |
| I6 | Every signed action runs at most once | `_checkSafety` (`nonceUsed`) | `NonceReused`, `Expired` | "a widening signature cannot be replayed (I6)", "an expired deadline reverts with Expired and leaves the nonce unused" |
| I7 | An inactive precompile makes every PQ path revert | `QorePQC` library | `PrecompileInactive` | "fails closed when the PQ precompile is inactive (I7)". It covers the factory deploy path only; there is no test of an account call against an inactive precompile |
| P1 | The pilot never sets a wall above the phone-signed policy, and a raise lasts at most one period | `setLive`, `effectiveCaps` | `AbovePolicy`, `TooFarAhead`, `NotPilot` | "can never set a wall above the phone-signed policy", "a raise can last at most one period", "worst case when hijacked is the policy itself" |
| P2 | The pilot is never the laptop or the phone key | `deploy`, `setPilotWithApproval`, `executeLoosen(SetPilot)` | `BadInit`, `BadPilot` | "the factory refuses a pilot that is the laptop or the phone", "refuses a forged phone signature and a pilot that is the laptop" |
| R1 | Any tighten cancels every queued widening | `_bumpEpoch`, `executeLoosen` | `CancelledByTighten`, `TooEarly` | "any tighten cancels a queued widening", "a phone seal cancels queued widenings" |
| R2 | The recovery account is another Bulkhead account | `deploy`, `executeLoosen(SetRecovery)` | `RecoveryNotAccount` | "refuses a recovery address that is not a Bulkhead account" (factory); the account path is exercised in the randomised sequences |
| R3 | The contract never calls `ecrecover` | Whole contract | Not applicable | No test. It holds by inspection: `BulkheadAccount.sol` contains no `ecrecover` |

## 4. Threats

| Threat | Entry point | Worst case | Control | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Laptop key stolen, by day | `spend` | The blast radius: min(per-tx cap, period allowance left, balance above floor). Any breach seals and moves nothing | `spend`, `blastRadius` | Test "over the per-transaction cap: trips and seals without reverting, moves nothing". Tx 0x687fb72d3e47b14a2f105d5aabdff640f2486508f7fd1fcb8ac4c1f51bb6878b |
| Laptop key stolen, in quiet hours | `spend` | The pilot's resting wall. A larger spend inside the policy is held, not sealed | `effectiveCaps`, `HeldByPilot`; `planRequest` refuses raises in quiet hours | Test "refuses a spend over the live walls without sealing, and seals over the policy as before". Tx 0xbe76fc8c5abb970e97993a7327d821dc97808c3b042ab410e98989a8e7c4b65a |
| Reopening the wall | `setLive`, `tightenPolicy` from the laptop | Nothing | Laptop may only lower: `NotTighter` | Test "the laptop can lower the live walls but never raise them"; refused live in round 25 |
| Moving the schedule (PR #9) | `POST /api/pilot` settings | A stricter schedule only. A looser one waits in `pendingSettings` | `isTightening` in `server/pilot.ts`; `approveSettings` checks the phone's ML-DSA-87 signature with `phoneSignedSchedule` (`pqcKeyStatus`, `pqcVerify`, fails closed, nonce kept in `usedNonces`) | Server test "schedule changes: only a stricter schedule counts as tightening". No automated test of `phoneSig.ts`; a live precompile check was run |
| Hijacked pilot | `setLive` | The phone-signed policy, as with no pilot | `AbovePolicy`, `TooFarAhead`; the pilot cannot spend, seal, unseal or bump the epoch; `removePilot` by the laptop at once | Tests "worst case when hijacked is the policy itself", "can't spend, seal, unseal or widen the policy" |
| Hijacked bill agent, or invoice prompt injection | `/api/bills` run, `server/agent.ts` | The agent account's balance, fUSD only, 10 per payment, 25 per day, only `fUSD.transfer` | The model only extracts; `decide()` in `server/policy.ts` decides; the chain spending rule set in `agentKey.ts`; Bulkhead `spend` is `onlyEveryday` | Test "the poisoned invoice always goes to the phone, whatever its text says". DEPLOYMENTS.md: agent compartment, live (blocked over 10 and over 25) |
| Relayer abuse | `POST /api/relay` | Gas spend on calls that pass simulation; refusal to relay | `classify` allows only phone-signed calls, `confirmSafety` and `deploy`, only to the factory or an `isAccount` address; `estimateGas` first; window scoped to the one target | DEPLOYMENTS.md live checks: forged approval 422, `seal()` 422. No unit test of `classify` |
| Queue tampering and replay | `/api/requests` | Hiding, expiring or mislabelling a request (denial of service). It cannot read or forge one | Requests are QoreSeal ciphertext to the phone's ML-KEM key; the phone rebuilds the call from the intent and reads chain values (`src/chain/requests.ts`); replay is stopped on chain by `nonceUsed` | Server tests "refuses anything that isn't a QoreSeal envelope", "an approval needs its transaction hash, and settles only once" |
| Pairing man in the middle | `/api/pair` | A swapped reply, caught if the owner compares words | QR commits to the laptop's ML-KEM-1024 and X25519 keys; card verified against the phone's on-chain keys; four words from the whole exchange; one reply only | Server test "takes one sealed reply, then refuses a second"; round 26 live pairing |
| Forged ML-DSA signature | Any `*WithApproval`, `queueLoosen`, `deploy` | Nothing | `_checkSafety` reverts `BadSafetySignature` | Tests "refuses a forged signature", "refuses a forged phone seal". DEPLOYMENTS.md v2 and v4: forged signatures refused |
| Phished widening | `queueLoosen` | Nothing during `loosenDelay`; the owner sees it queued and any tighten cancels it | `readyAt`, `queuedEpoch`, `CancelledByTighten`, `TooEarly` | Tests "a signed widening waits out the delay, then anyone can run it", "any tighten cancels a queued widening" |
| Lost phone | `proposeSafety` | A sealed account and a long, visible wait | Seals at once; `safetyDelay` at least `loosenDelay` (factory `BadInit`); veto by `cancelSafetyChangeWithApproval`; new key must be proven | "Lost phone" tests. Txs 0xbe82ce109c27965421247380565105b1ad48d2e82cc3f1805b33eadbea503c34 and 0x442daf6d6409c1698c308684031d0cb31a39d51a3cedc6429547635efba3a68f |
| Break-glass misuse | `breakGlass` by a thief | Funds go only to the pinned recovery account | Recovery must satisfy `isAccount`, so it cannot share the laptop seed; setting it is a delayed widening | Tests "the everyday key can only send everything to the pinned recovery account", "refuses a recovery address that is not a Bulkhead account" |
| EVM window abuse | The laptop's open window | Calls to the Bulkhead account only; fees bounded by `maxValue` | `openScopedWindow` lists only the account (300 blocks, 3 txs, 0.6 QOR); the relayer's window lists one target. Never a token: spike round 16 drained 200,000 tokens with a stolen permit while a window listed the token, without touching the window budget | SPIKE-LOG rounds 14 and 16 |
| Stale-storage race | Blob reads in pilot, bills, queue, pairing | Acting on an old schedule (seen live in round 26) | `blobjson.ts` writes every save as a new version and reads the newest | DEPLOYMENTS.md round 26b retest |
| Malicious web deployment | Served JavaScript | Everything the unlocked laptop key can do (the blast radius); on the phone, a request the owner might sign | The contract bounds the laptop key; widenings wait out `loosenDelay`; the phone shows what it computed, not the laptop's text | No code control against bad JS. See residual risks |
| Quantum adversary | ECDSA laptop key | The stolen-laptop rows above | Every widening needs ML-DSA-87; the native lane needs hybrid signatures | Design; no separate test |

## 5. Residual risks and limits

- **Testnet only.** No mainnet deployment.
- **Centralised pilot and relayer.** One server holds the pilot key and the relayer key. If either is down, walls stay where they are and phone-signed calls must be sent another way. Anyone can run a relayer, but the app points at ours.
- **Shared bill-agent account.** One agent account and one chain cap of 25 fUSD a day serve every user.
- **Web app trust model.** The app is served from Vercel. A compromised deployment or dependency could steal the laptop key when unlocked, or show the phone a misleading screen. No native or locally built app exists.
- **Once-a-day cron.** Vercel runs the pilot at 06:43 UTC and bills at 10:17 UTC (`app/scripts/vercel-output.mjs`). Other pilot moves happen when the app opens and calls a tick. A GitHub Actions tick is planned; it is not on `main`.
- **No independent audit.** The contracts have their own test suites only.
- **Server gaps found while writing this.** Laptop-signed changes to `/api/pilot` and `/api/bills` carry a time but no nonce, so one can be replayed within five minutes. `settle` on `/api/requests` and the cron and tick endpoints need no authentication, so anyone can mark a request refused or trigger a pilot tick (the tick only follows the saved schedule). Pilot and bill records are stored as public Blob objects; queue records are ciphertext. `relayer.ts` `classify` and `phoneSig.ts` have no unit tests.
- **Risk register items not done in code:**
  - Sentinels: the contract supports `throttle`, but no sentinel service exists, so no tripwire watches windows, idle windows or delegation consents (W5, R4, R17).
  - Idle-window throttle and auto close (R3): windows expire by block count only.
  - Parity suite in CI (W8, R8): there is no CI workflow in the repository.
  - EIP-7702 (W12): the attack failed, but so did the legitimate path, so the defence is unproven.
  - W4 says a leaked classical key can trigger evacuation; in code that is `breakGlass` by the laptop key, and it is only safe because the recovery account was pinned in advance.
  - W9 and W10 (competition and self-grading) are not technical and have no code answer.

## 6. Out of scope

- Bugs in QoreChain consensus, its precompiles or the `@qorechain/sdk`, QoreSeal and QoreSign libraries.
- Compromise of both devices at once, or a phone whose password and storage are both taken.
- Coercion of the owner.
- Token contracts that misbehave beyond returning no value or false on `transfer`.
- Privacy of balances and transfers, which are public on chain.
- Denial of service against Vercel, the public RPC or the REST API.
