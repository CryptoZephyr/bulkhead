// Docs pages, in reading order. Every fact here has a row in docs/CLAIMS.md.
import type { ReactElement } from "react";
import { Plate, UnderTheHood, Compartments, CanCant, Tx } from "./Parts";

export type DocPage = { slug: string; section: string; title: string; lead: string; body: () => ReactElement };

export const SECTIONS = [
  { id: "idea", name: "The idea" },
  { id: "using", name: "Using it" },
  { id: "wrong", name: "When something goes wrong" },
  { id: "proof", name: "Proof" },
] as const;

export const PAGES: DocPage[] = [
  {
    slug: "what-is-bulkhead",
    section: "idea",
    title: "What is Bulkhead?",
    lead: "Bulkhead puts walls inside your money, so a stolen laptop or a hijacked AI agent can only take what's inside one wall. Only your phone can make a wall bigger.",
    body: () => (
      <>
        <Plate title="The problem">
          <p>Imagine someone takes your laptop while your wallet is unlocked. In most wallets, whoever holds it can send everything you own, to anyone, at any hour. If an AI agent pays your bills from that wallet, that's one more key that can empty it.</p>
        </Plate>

        <Plate title="What Bulkhead does instead">
          <p>Your money sits in separate compartments, like the sealed sections inside a ship. If one floods, the walls keep the water there.</p>
          <Compartments items={[
            { name: "Everyday", holds: "What you spend from your laptop.", wall: "A limit per payment and per day." },
            { name: "Savings", holds: "What you keep.", wall: "Your laptop can never spend below it." },
            { name: "Bills", holds: "The bill agent's own account.", wall: "10 a payment, 25 a day, approved payees only." },
          ]} />
          <p>The number that matters is shown on your Hull screen: <strong>the most anyone could take right now</strong>. That's what a thief with your laptop could get, today, at this minute.</p>
        </Plate>

        <Plate title="The one rule" tone="dark">
          <p className="docs-rule">Your laptop can only make walls smaller. Only your phone can make them bigger.</p>
          <p>Your laptop spends inside the walls and can tighten them at any time. Making a wall bigger needs a signature from your phone, which holds a separate key. A thief needs both devices, not one.</p>
        </Plate>

        <Plate title="The wall moves with your day">
          <p>An agent called the pilot keeps your wall low while you sleep and opens it when your day starts. It can never open it above what your phone signed. In the live run, the wall was 0.25 at night and 2.50 in the daytime.</p>
          <p>If you need more for a few hours, you can ask in plain words, like "about 12 until 6pm, I'm shopping". The AI only reads the amount and the time. Plain code decides, and the chain enforces it.</p>
        </Plate>

        <UnderTheHood>
          <ul>
            <li>Each account is its own smart contract on QoreChain testnet (<span className="mono">BulkheadAccount</span>), made by a factory contract. Nobody, including us, can change its rules after it's made.</li>
            <li>Your phone's key is post-quantum: ML-DSA-87. The contract checks its signatures with QoreChain's <span className="mono">pqcVerify</span> and <span className="mono">pqcKeyStatus</span> precompiles, so a quantum computer that breaks today's keys still can't widen a wall.</li>
            <li>Your laptop's key only acts through a short EVM window scoped to your account, so a leaked laptop key can't call anything else.</li>
            <li>The bill agent's limits are a spending rule on its own chain account, enforced by QoreChain, not by our server.</li>
          </ul>
        </UnderTheHood>
      </>
    ),
  },
  {
    slug: "someone-has-my-laptop",
    section: "wrong",
    title: "Someone has my laptop",
    lead: "They can take at most what's inside your Everyday wall at that moment. Anything bigger is stopped by the chain, and your account closes itself.",
    body: () => (
      <>
        <Plate title="What they can and can't do">
          <CanCant
            can={[
              "Pay up to your wall as it is right now. At night that's your night wall.",
              "Ask your phone for more. Your phone simply doesn't approve.",
              "Send your money to your own recovery account, if you set one. That's the only place it can go.",
            ]}
            cant={[
              "Pay more than your wall. The payment is held and nothing moves.",
              "Make any wall bigger, or shorten your quiet hours. That needs your phone.",
              "Touch your Savings below the amount you keep.",
              "Reopen the wall after the tripwire closes it.",
              "Approve anything for your phone. Its key never leaves your phone.",
            ]}
          />
        </Plate>

        <Plate title="The tripwire" tone="alarm">
          <p>The pilot watches your account. If it sees any of these, it closes every wall to zero:</p>
          <ol>
            <li>a payment that was held because it was over your wall,</li>
            <li>a payment from your laptop during your quiet hours,</li>
            <li>3 payments from your laptop within 10 minutes.</li>
          </ol>
          <p>From then on nothing leaves Everyday. Your laptop can only ask your phone to reopen it. Only a signature from your phone does.</p>
          <p>In our live test, a stolen laptop key tried to send 5.00 just before midnight, in quiet hours. It was held, nothing moved, and about a minute later the tripwire closed the wall. <Tx hash="34A669A4B970159795F06247C0E70BFA2C6F461434B8FEBEFBFCDF802FE58EF3" label="Held payment" /> · <Tx hash="BF333A249921DFDDEDC9CE63D4DDB2079531F8A6A1C61E1974727EE8636B6AE7" label="Tripwire closes the wall" /></p>
        </Plate>

        <Plate title="If a payment is far over the limit">
          <p>A payment bigger than the walls your phone signed doesn't just get held. Your account seals itself inside that same transaction and moves nothing. Sealed means nothing can leave until your phone unseals it.</p>
        </Plate>

        <Plate title="What to do" tone="dark">
          <ol className="docs-steps">
            <li><strong>Don't approve anything on your phone you didn't ask for.</strong> If a request shows up, press "I didn't ask for this". It refuses the request and seals your account from your phone.</li>
            <li><strong>Leave the wall closed.</strong> If the tripwire closed it, don't reopen it from your phone until you have your laptop back.</li>
            <li><strong>Move everything to safety, if you want.</strong> On your phone, "Send everything to my recovery account" sends Everyday and Savings there at once. You need to have set a recovery account in Account first.</li>
            <li><strong>When it's safe again,</strong> unsealing is a change your phone approves. It takes effect about an hour later.</li>
          </ol>
        </Plate>

        <UnderTheHood>
          <ul>
            <li>A payment over the live wall but inside your phone-signed policy is refused with a <span className="mono">HeldByPilot</span> event. A payment over the policy trips the account's seal in the same transaction. Both return transaction code 0, so Bulkhead reads balances and events, never the code.</li>
            <li>The laptop can't raise a wall: <span className="mono">setLive</span> and <span className="mono">tightenPolicy</span> revert with <span className="mono">NotTighter</span>.</li>
            <li>The tripwire is plain code in <span className="mono">app/server/pilot.ts</span>, run every 5 minutes from GitHub Actions and whenever the app is opened. GitHub can run late, so the close can take a few minutes. In our test it took about one.</li>
            <li>Reopening needs your phone's ML-DSA-87 signature over that exact trip, checked against your on-chain key.</li>
            <li>The recovery account must be another Bulkhead account, set earlier by a phone-approved change.</li>
          </ul>
        </UnderTheHood>
      </>
    ),
  },
];
