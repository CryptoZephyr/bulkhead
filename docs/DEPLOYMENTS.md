# Testnet deployments (qorechain-diana, EVM chain id 9800)

Transactions are listed by their EVM hash. The QoreChain explorer opens on mainnet and finds transactions only by their native hash, so choose **Testnet** at the top of the explorer, then use the explorer link beside each hash.

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
| Everyday spend 2.00 fUSD, window scoped to the account | paid | 119,277 | 0x83af506eee4d723a1829af15d42f295ee579b807d96c12821bc7d38f4243da73 ([explorer](https://explore.qore.network/tx/489F62A2CFF57C9F390626A6B5219414397AAF2F4E65C015BE62180079B0C82B)) |
| Stolen key spends 6.00 fUSD, over the 5.00 per-payment cap | tx success, sealed, nothing moved | 109,584 | 0x687fb72d3e47b14a2f105d5aabdff640f2486508f7fd1fcb8ac4c1f51bb6878b ([explorer](https://explore.qore.network/tx/52E66F3E23B4A78F7BA5226ABD93687A565E19F256F4DB29E34A92666EF6889C)) |

The demo account now holds 68 fUSD, is sealed, and its blast radius is 0. It unseals only through a Safety-key widening after the delay.

## Contracts v2 (21 November, round 23): phone-only seal and lost-phone replacement

| Contract | Address |
|---|---|
| BulkheadFactory v2 | 0xe723f38ffb199548f96da2b6cc677cbb2740372f |
| Demo account v2 (current, 100 fUSD, open) | 0x3d68f146EaEbFBCB1C0f64eFC07DbD687fc76959 |
| Test account v2 (phone replaced, sealed) | 0x5412c0F2267872aFc7E53312d6A25a778619d0Ca |

| Step | Result | Transaction |
|---|---|---|
| Deploy factory v2 | OK, gas 3,674,293 | 0xac4965eab7721876759e1af2e8c59b8855b9c446c7d75c2f30cc3d91b06e685b ([explorer](https://explore.qore.network/tx/CA266CAA0C1B3C05FDD0AA22F2307AC8BAB9FD90B148389F1A4DAA679254D7B2)) |
| Deploy demo account v2, real ML-DSA-87 | OK, gas 2,767,666 | 0x5490692bd52aa0c07f62710cf99b7990caa1a7a7878b022e4d9f9482147dc32d ([explorer](https://explore.qore.network/tx/42D8C2F20109742919C68D02EC170F76CA87328BC7B92697324F70BF97C365E9)) |
| Forged phone seal | refused, BadSafetySignature | |
| Phone seals on its own | sealed | 0x11a44d14473550395c10f9073a46e2acdb193dc6e3bb6c2e77b8fd38aba0fb95 ([explorer](https://explore.qore.network/tx/5F3CFB86696E581BC5D8332689B6E22C050E40D5DDE915FBE96AA0B78108C2B2)) |
| Laptop proposes a new phone | sealed, wait started | 0xbe82ce109c27965421247380565105b1ad48d2e82cc3f1805b33eadbea503c34 ([explorer](https://explore.qore.network/tx/0C3E9C64369EF54EB38B37E7DDB29D5270D06C7FFEC3A409C4A5A8751BE03D33)) |
| Old phone vetoes it | cancelled | 0x442daf6d6409c1698c308684031d0cb31a39d51a3cedc6429547635efba3a68f ([explorer](https://explore.qore.network/tx/4B706AE1182B0DA861D0447748B4218E3E39392F4AC542ED31B05A0E5C0C49D0)) |
| Laptop proposes again (old phone lost) | wait started | 0xa23dc1777eff378572e5aee6e14be7d54a8071d981e26edbec7d6b1a5eb9f229 ([explorer](https://explore.qore.network/tx/06BE7392BCDE0103776BBDDFA529D034B522BF96C393452BB77DB0FE99CCAA7F)) |
| Confirm before the wait | refused, TooEarly | |
| Confirm after the wait | new phone in charge, account still sealed | 0x5afafb74d82dc7540e0777a51dbed11785e4ae3de2a64814857e3db74f60e8da ([explorer](https://explore.qore.network/tx/14675A1DF8576C7DE52B8A4E65C2263F7184394E61CFFE7EAB7A17C249DED522)) |
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
| Relayer: real ML-DSA-87 phone approval (add payee on demo v2) | 200, tx 0x02f5f2c2c7dcdb097895508c4c5c2d4bec8abb83cb4bc6883b2440a98666d3a5 ([explorer](https://explore.qore.network/tx/EE79B8C257F5067B76C01749581241461A34959E0F50D46FC4D9C3CB99B25975)) |
| Agent: poisoned "pay 5000 to an unknown address" invoice | ask-phone, nothing paid, queued sealed to the phone (2,599-char envelope, amount not in plain text) |
| Agent: invoice whose address the model mangled | rejected, nothing paid |

## Contracts v3 (21 November, round 25): the pilot, a blast radius that breathes

The pilot is added only by the phone (Loosen.SetPilot, real ML-DSA-87, then the widening delay). It moves the live walls inside the phone-signed ceiling, here 5.00 per payment and 15.00 a day. The laptop can only lower the live walls, so a stolen laptop key alone can't reopen a wall the pilot closed. A raise closes itself when it expires.

A first v3 factory (0x6b1f671a674ebe6d0bcfba235e9f4874e431626b) let the laptop raise the live walls too. It was replaced the same day and must not be used.

| Contract | Address |
|---|---|
| BulkheadFactory v3 (current) | 0xcec5ef27b5ce235c2c13ef8f1549abb986099db6 |
| Pilot test account v3 (17 fUSD, open) | 0xeCF93Fe3c4565e4cF7a809Deb35482BFcbDDC7Ad |
| Pilot key | 0x617DE59bcA65Ce7208dB8c77ebCF7382833aE159 |

| Step | Result | Transaction |
|---|---|---|
| Deploy factory v3 | OK, gas 4,076,150 | 0xd40a62e02109a707435982f575d36c81fa3bc70d87bbb4551c1f233ff33c9bb5 ([explorer](https://explore.qore.network/tx/8E5161DDB7CA239EA0B7155259C216116B69A38017D40063FDCDA9597D7B50FB)) |
| Deploy account v3, real ML-DSA-87 | OK, gas 3,116,461 | 0x4ddcc4f1b935ebe599c6f3ce0b87db7cdac74c210abd5041bf16e3c0285c5b58 ([explorer](https://explore.qore.network/tx/A8291706C6F092D222B97F67551EB1FD256FDA3E075FA60037A031D92FD945F5)) |
| Fund 20 fUSD (MsgConvertCoin) | blast radius 5.00 | 772713BD9D1F65C15BEDE00212BEF45EC2DFB7D8437ABC23D49C81015A4233F0 |
| Phone signs "add the pilot" | queued | 0xac2e3563451840028966bdae48506775296f6e56a3349b8b5112eed54520bcd7 ([explorer](https://explore.qore.network/tx/E9A91A5276014A4BA52A7054DBC3A0816B9FB0A70917AB9C39810A51446B58C1)) |
| Run it after the delay | pilot set | 0x371105812d2bb9505c332d05bcc920acda12424e1f0f540a4933c1045707857e ([explorer](https://explore.qore.network/tx/0858FD6352CE17A91875CC39FA188740B7419EB6B84F34A1C74B83145E746276)) |
| Pilot lowers the wall for the night | blast radius 0.40 | 0x2fbbdad9becb756118dfc7434da9f87deb07e94c26de91241201e5aba5458483 ([explorer](https://explore.qore.network/tx/ACD65931CCEE4169067DB0BEFB5A2AC9C5FE2649BFE562B7DE94057C9A17A8A0)) |
| Stolen laptop tries to reopen the wall | refused, NotTighter | |
| Stolen laptop tries 5.00 at night | HeldByPilot, nothing moved, not sealed | 0x9feb3542945699996bd3c4aae0b8ca84dee86c7a4edfb5d12b481c971cc26771 ([explorer](https://explore.qore.network/tx/D1D532374DEE171EA71AEBCD1EB6A9B6F6CD860E55B917709B03753B8EA357D4)) |
| Pilot raises to the ceiling for 40 blocks | blast radius 5.00 | 0xfcb0c383a499067119fbce26031d92f4b640c28da3ec59e26a9205fc46c8281b ([explorer](https://explore.qore.network/tx/363F5ACA0DB7877EA915A6CA7C41B660C7C6EAE9C72248DBAD3AE6C3C1536F74)) |
| Owner pays 3.00 during the raise | Spent, 17 fUSD left | 0xeb7904c3cfc807551c804f001005fa96b37f0efac67e9091dc16f34ba6491d31 ([explorer](https://explore.qore.network/tx/743A0708C5E8AFF956CC7217F663A98F6FB1FC87922D65DA7AC7351D8CFEB818)) |
| Pilot tries to go above the ceiling | refused, AbovePolicy | |
| The raise expires, no pilot action | blast radius 0.00 (rest 0.40 a day, 3.00 already spent today) | |

## Live site end to end (21 November, round 26)

Run against https://bulkhead-blush.vercel.app through its own APIs only (relay, pilot, pair). The production pilot key lives only on Vercel.

| Step | Result | Transaction |
|---|---|---|
| Phone authorises a new v3 account, live relayer deploys it | account 0x6759AD2986A2CFABBC1be669c7eaad7c8d7382df | 0xba5720b66bd79ceadbb105dba3bf77dca1c9551f9c287e9602eceb46337641d6 ([explorer](https://explore.qore.network/tx/788E82BA693AB6D35808F850996C7D11BACD36A043C68D0C50CB4E35361E4F6E)) |
| Phone signs "add the pilot" (production pilot 0x4e21ed6743B7e8D169f6C09f5045D016B53f3888) | queued | 0x8c676d338cef880a0cc5acb73124edff2f90f600bd3f3e0d9e277cc56b044277 ([explorer](https://explore.qore.network/tx/5DD3910A77B3DD3C27A60A211FBD34E06642F24D667F6E3598B12F9E0AA65572)) |
| Live relayer finishes it after the delay | pilot set, blast radius 5.00 | 0xe39041dc9fa8fabcefd5f6c62e802045067b3fbf29ebbd1d0c4dc360eeb6507a ([explorer](https://explore.qore.network/tx/73159ECAF3D6CF7BE0C9F365945438CB38E6494775F53B76CE522A918698AC9E)) |
| Laptop saves quiet hours covering now, live pilot closes the wall | blast radius 0.30 | 0x500f34a27153fb88a5e77cae4040c98a7bfab17828789801d919cb7406d90f8a ([explorer](https://explore.qore.network/tx/383CEA27791A393CFD5B2617E2B907EDDA6F6E815A3DCF2C9DB4D02DB82B68B6)) |
| Ask for 4.00 during quiet hours | refused, sent to the phone | |
| Stolen laptop tries to reopen the wall | refused | |
| Stolen laptop tries 5.00 | held, 10.00 fUSD left, not sealed | 0xbe76fc8c5abb970e97993a7327d821dc97808c3b042ab410e98989a8e7c4b65a ([explorer](https://explore.qore.network/tx/8E8F7B168D87D3DF9CA748168CB4BA0C9BB96205E3527BF164801697B1CBC6A5)) |
| Move quiet hours away (daytime) | FAILED: the pilot read the previous quiet hours from storage. Fixed in PRs #4 and #5 | |
| Pairing relay: start, phone's sealed card, second reply | 201, 200, refused 400; only the laptop could open the card | |

### Retest after PRs #4 and #5 (21 November, round 26b)

| Step | Result | Transaction |
|---|---|---|
| Daytime hours saved, live pilot opens the wall | blast radius 0.30 to 2.00 | 0x5e45a9908dae5591e104680eb21fba20109219ecd5a24835eff5c1dd5fa5b9bf ([explorer](https://explore.qore.network/tx/7EF040665BCF269B3D5D33F3457136EF9CC16C317CE5DA8C5418A6D66758B42E)) |
| "about 4 until 14:00, shopping": the model read 4 and 14:00, code opened within the ceiling | blast radius 4.00 | 0x72cf2e470b258733f133812fd60fadb1163fb816014e6fa80decad2e5ad404d2 ([explorer](https://explore.qore.network/tx/5C1330D560838261BDE608FC75E47880E58C5B049BA784516C7EA0AC2C79FAC7)) |
| Back to quiet hours | blast radius 0.30 | 0x9a7a337c8e6de514f66eb5ed7161fb35f8bb1a190338e2125f675d50a65896f8 ([explorer](https://explore.qore.network/tx/C34DDD6562C74B26C0D0C7B49C6CC958DB1F3FF0FBF0F4725A1E7C9196422674)) |
| Browser walk of the live site (landing, setup, pilot, hull, phone) at 1280 and 390 px | all load, no page errors, no sideways scroll | |

## Contracts v4 (25 November, round 27): the pilot with no wait

Adding the pilot widens nothing (it can only move the live walls inside the phone-signed policy), so v4 drops the widening delay for it. The pilot is part of the phone-signed Init at creation, and the phone can set or replace it later with setPilotWithApproval, effective at once. A pilot can never be the laptop or the phone key. Real widenings keep the delay.

| Contract | Address |
|---|---|
| BulkheadFactory v4 (current) | 0xdd2e1ed55393db01086c5a4d829f4558094870cb |
| Test account v4 | 0x8F8831056835ff1b88f3C46350eBFe8BC90c5bc4 |

| Step | Result | Transaction |
|---|---|---|
| Deploy factory v4 | OK, gas 4,223,411 | 0xd62d692d08ad97fd66bbd2e03e4742adad52daf1d87f7cd024754b96ba533c67 ([explorer](https://explore.qore.network/tx/281E4BBB65C0177400493728890FBCC9D1D7CD128A81B91E506DC510454B9E1C)) |
| Pilot equal to the laptop key at creation | refused, BadInit | |
| Create account v4 with the pilot in the phone-signed Init (loosenDelay 2,500) | pilot set from block one | 0xca1c60fe0f73f450c04a53fabf254640fb790f0edc097a10a61f140f9bc6025d ([explorer](https://explore.qore.network/tx/682D15B3237A7E325DBCE8739560CA8E379FC710C06745BE12379AE8A9F7FC00)) |
| Pilot lowers the wall right after creation | caps 0.40 / 0.40 | 0x5053704c3b8ed01dcbc04a1e4d2c918f84ebca0fba9f7394a41cc5686579233a ([explorer](https://explore.qore.network/tx/5BC44C5D71034B5B26CEB38D8CE125F6FAC3A33744373BDCCCC46C9E8BBE80F5)) |
| Forged phone signature to change the pilot | refused, BadSafetySignature | |
| Phone replaces the pilot, effective at once (real ML-DSA-87) | production pilot set, no delay | 0xf9ae8c9dbaf8bbf6b3c716824bc980d00202a6d351b787acd44dbd9320894b11 ([explorer](https://explore.qore.network/tx/B75229E1071951BD34C7702E6B5ED25910B7FDA83C5EA1E3BD05A026A7699CFE)) |

## Live site on v4 (25 November, round 28)

After the v4 merge, with the relayer serving v4, v3 and v2 accounts.

| Step | Result | Transaction |
|---|---|---|
| Phone authorises a v4 account with the live pilot in its Init, live relayer deploys it | account 0xE44f94756f274bb41522077Af66F8213733453C2, pilot from block one, loosenDelay 2,500 | 0xc6eb942ee418004734edcbcaff30956e9e95e0ab8e8df755a908c0d7c15aa373 ([explorer](https://explore.qore.network/tx/05AC2310072449DACDAE2118AF63BEAF21C9E46859EE18A750AB3E408787274B)) |
| Quiet hours saved, the live pilot closes the wall at once | caps 0.30 / 0.30, no widening delay involved | 0x188f9842e192ddfd9191a5f30fc3c0823ab9b7209e095b889531ec5062b3a578 ([explorer](https://explore.qore.network/tx/5E59109588179E9F87F374ECDE58D20E47B1D4896FEFE2F8E2DE63A916BF808D)) |

## Design findings from earlier testnet rounds

These red-team results shaped the contracts. Transaction hashes were recorded shortened at the time.

| Finding | What happened on testnet | Design rule it led to |
|---|---|---|
| A window that lists a token exposes the whole balance | With a stolen permit, an attacker called `permit` and `transferFrom` from their own account and drained 200,000 test tokens while the owner's window, scoped to that token with maxTxs 1, still showed 0 of 1 used (0xccce3fc8...243d, 0x9ebf0f30...2ae) | EVM windows are scoped to the Bulkhead account only and never list a token |
| The ecrecover gate checks the contract that runs ecrecover, not the target | A token called through another contract could not verify the owner's permit, but any contract in the owner's window scope can verify the owner's ECDSA signatures from anyone's transaction | The account never uses ecrecover |
| Fee loss inside a window is bounded | A leaked key burning gas in a window with maxValue 300,000 uqor lost 0.140625 QOR in total and was refused once the budget ran out | Windows are short and small: 300 blocks, 3 transactions, 0.6 QOR |
| Chain spending rules hold on the EVM lane | An agent key with a rule of 10 per execution and 25 per day, only `transfer`, executed an 8 transfer and was blocked at 50 | The bill agent runs on its own account under a chain spending rule |

## Storage moved to Redis (27 November, round 29)

The Vercel Blob store `bulkhead-queue` was suspended on 27 November for exceeding the free plan's operations quota, because every read listed storage. This took down the approval queue, pairing, pilot settings and Bills. Nothing on chain was affected. Server state moved to Upstash Redis in PR #17, and the live site was tested at https://bulkhead-blush.vercel.app.

| Step | Result | Transaction |
|---|---|---|
| Pairing start | 201 | |
| Keys read back immediately | same keys | |
| Reply | 200 | |
| Second reply | refused, 400 | |
| Reply read back | the reply that was sent | |
| Pilot schedule saved on 0xE44f94756f274bb41522077Af66F8213733453C2 and read back immediately | quiet hours 12:00 to 14:00 | |
| Scheduled pilot run | 1 account, 0 failed (it was 5 failed on the suspended store) | |

The GitHub Actions pilot tick (every 5 minutes, `.github/workflows/pilot-tick.yml`) was run by hand on 27 November and succeeded.
