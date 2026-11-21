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

## Stolen-key seal on the fUSD demo account (21 November, round 22)

| Step | Result | Gas | Transaction |
|---|---|---|---|
| Everyday spend 2.00 fUSD, window scoped to the account | paid | 119,277 | 0x83af506eee4d723a1829af15d42f295ee579b807d96c12821bc7d38f4243da73 |
| Stolen key spends 6.00 fUSD, over the 5.00 per-payment cap | tx success, sealed, nothing moved | 109,584 | 0x687fb72d3e47b14a2f105d5aabdff640f2486508f7fd1fcb8ac4c1f51bb6878b |

The demo account now holds 68 fUSD, is sealed, and its blast radius is 0. It unseals only through a Safety-key widening after the delay.

## Contracts v2 (21 November, round 23): phone-only seal and lost-phone replacement

| Contract | Address |
|---|---|
| BulkheadFactory v2 | 0xe723f38ffb199548f96da2b6cc677cbb2740372f |
| Demo account v2 (current, 100 fUSD, open) | 0x3d68f146EaEbFBCB1C0f64eFC07DbD687fc76959 |
| Test account v2 (phone replaced, sealed) | 0x5412c0F2267872aFc7E53312d6A25a778619d0Ca |

| Step | Result | Transaction |
|---|---|---|
| Deploy factory v2 | OK, gas 3,674,293 | 0xac4965eab7721876759e1af2e8c59b8855b9c446c7d75c2f30cc3d91b06e685b |
| Deploy demo account v2, real ML-DSA-87 | OK, gas 2,767,666 | 0x5490692bd52aa0c07f62710cf99b7990caa1a7a7878b022e4d9f9482147dc32d |
| Forged phone seal | refused, BadSafetySignature | |
| Phone seals on its own | sealed | 0x11a44d14473550395c10f9073a46e2acdb193dc6e3bb6c2e77b8fd38aba0fb95 |
| Laptop proposes a new phone | sealed, wait started | 0xbe82ce109c27965421247380565105b1ad48d2e82cc3f1805b33eadbea503c34 |
| Old phone vetoes it | cancelled | 0x442daf6d6409c1698c308684031d0cb31a39d51a3cedc6429547635efba3a68f |
| Laptop proposes again (old phone lost) | wait started | 0xa23dc1777eff378572e5aee6e14be7d54a8071d981e26edbec7d6b1a5eb9f229 |
| Confirm before the wait | refused, TooEarly | |
| Confirm after the wait | new phone in charge, account still sealed | 0x5afafb74d82dc7540e0777a51dbed11785e4ae3de2a64814857e3db74f60e8da |
| Fund demo v2 with 100 fUSD (MsgConvertCoin) | 100 fUSD, blast radius 5.00 | 2AEE70588179627494D6C2B0D0B4B0A6FABDA1154D87427E3E69E5A17C4DB442 |

The earlier factory and demo accounts stay on chain; the replay and activity history link to their transactions.

## Agent key renewal and QoreX funding (21 November)

| Check | Result | Transaction |
|---|---|---|
| Renew the agent key (revoke and re-link the same key, same rule, one tx) | expiry moved forward | FBD05D236AF1534DD63E2918F2D17DF29073EB362275DBB7AB6A689BD1805632 |
| Renewed key pays 0.50 fUSD | paid | |
| Agent pays 1.50 after 24.00 that day | blocked by the chain's 25.00 a day rule | |
| QoreX (official wallet mock, real signing) converts 1.00 fUSD into demo v2 | 100 to 101 fUSD | 9C16E0E76D936BD82164901B10AE0F6CD082B61D4E74142D250CD8095C8B4F67 |
| QoreX sends 0.01 QOR to demo v2 | arrived | D00F44FA649E73414BB8E8C65E1E71C6005D60BF519375B537C046BF8EE06740 |

## App deployment (Vercel, 21 November)

- Live: https://bulkhead-blush.vercel.app (production, built from branch phase-2-app, commit b9f2461)
- Project: Vercel "bulkhead", root directory app/, Build Output API: static Vite build plus five esbuild-bundled functions (/api/rest, /api/relay, /api/requests, /api/agent, /api/agent-key).
- Approval queue: Vercel Blob store "bulkhead-queue" (ciphertext only). Checked live: a request written in one call was read back and settled in another.
- Checked live: the site loads the demo account from the chain with no errors; gateway reads work, paths outside the allowlist are refused (403); the queue refuses anything that isn't a QoreSeal envelope (400).
- Secrets are not set yet, so /api/relay and /api/agent* answer 503 "not configured". The owner adds them in the Vercel dashboard: RELAYER_MNEMONIC, AGENT_OWNER_MNEMONIC, AGENT_KEY_HEX, SERV_API_KEY.

Dedicated server keys (21 November): relayer qor1jucepu367uyf74dtrpqnxyawktagxaqslp6ffv (20 QOR, PQ key registered) and the bill agent's own account qor1h2cjmwcauhacd5w29j9ee5x88xz6349g7u0209 / 0xbAB12dbb1de5FB86D1CA2C8B9cd0c73985A8D4A8 (50 fUSD, 3 QOR, PQ key registered). Their mnemonics are not in the repo; the owner stores them in Vercel as Sensitive variables.

## Live server checks with secrets set (21 November)

| Check on https://bulkhead-blush.vercel.app | Result |
|---|---|
| Agent key renewed from the live server | linked for an hour, tx 1F554A42EB7587C8C4BC3C0A5EEFDF7B8D707A5EB88FFCC9CBC7B44A6959129C |
| Relayer: forged phone approval | 422, refused in simulation, no gas spent |
| Relayer: seal() | 422, only the owner's own keys can |
| Relayer: real ML-DSA-87 phone approval (add payee on demo v2) | 200, tx 0x02f5f2c2c7dcdb097895508c4c5c2d4bec8abb83cb4bc6883b2440a98666d3a5 |
| Agent: poisoned "pay 5000 to an unknown address" invoice | ask-phone, nothing paid, queued sealed to the phone (2,599-char envelope, amount not in plain text) |
| Agent: invoice whose address the model mangled | rejected, nothing paid |

## Contracts v3 (21 November, round 25): the pilot, a blast radius that breathes

The pilot is added only by the phone (Loosen.SetPilot, real ML-DSA-87, then the widening delay). It moves the live walls inside the phone-signed ceiling, here 5.00 per payment and 15.00 a day. A raise closes itself when it expires.

| Contract | Address |
|---|---|
| BulkheadFactory v3 (current) | 0x6b1f671a674ebe6d0bcfba235e9f4874e431626b |
| Pilot test account v3 (17 fUSD, open) | 0xB1819340FeD3bD5634ff7D4BCD1cB704b7329f48 |
| Pilot key | 0x617DE59bcA65Ce7208dB8c77ebCF7382833aE159 |

| Step | Result | Transaction |
|---|---|---|
| Deploy factory v3 | OK, gas 4,040,195 | 0x427489237244fb7bdb87fa864f08a53dd95254b8b3664abe85b8675e058d16dd |
| Deploy account v3, real ML-DSA-87 | OK, gas 3,084,158 | 0xde03a66bd9529412c68d1d0063edc10b758d5fb3a4ebe02db6e74988fa80d99b |
| Fund 20 fUSD (MsgConvertCoin) | blast radius 5.00 | 8B127B55B5BDD3F969AE0926D0DC49EA5971A75C228CE97DBCB2CACA44231E6C |
| Phone signs "add the pilot" | queued | 0x8a55eff94a054b5f75d61c981358b9275d9ed83e6173a9a0d4ccf2e4a5c9e5af |
| Run it after the delay | pilot set | 0xc2bee834603335d798687d372ab412218b844ad3eb624f8cf82953672bbe23c8 |
| Pilot lowers the wall for the night | blast radius 0.40 | 0x33ef4419a79d09fee238d5129b8636edbe9d9630726f62f3d15935cd90d07a44 |
| Stolen laptop tries 5.00 at night | HeldByPilot, nothing moved, not sealed | 0x33cf9721a05de114d82628e55c3579bc892cbed57831d124fdeccdc40c33d2f4 |
| Pilot raises to the ceiling for 40 blocks | blast radius 5.00 | 0x525d251d166e4eaa8b54b58f93752d5a788f74c03cb70947ee8b064854f3cce5 |
| Owner pays 3.00 during the raise | Spent, 17 fUSD left | 0x99c24bbea9d9bdf64e09520e2dc9fe0167e7f1c28d303439cf43924be201da41 |
| Pilot tries to go above the ceiling | refused, AbovePolicy | |
| The raise expires, no pilot action | blast radius 0.00 (rest 0.40 a day, 3.00 already spent today) | |
