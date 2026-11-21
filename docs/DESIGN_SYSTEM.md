# Bulkhead design system (proposal)

Status: revision 3, 21 November 2026. All decisions approved by the owner on 21 November 2026. Phase 2 build started. The owner supplied the logo and chose its colours for the palette (option a). Revision 2: Revision 1 reused eleven of Bell's specific inventions. The owner asked for all of them to be replaced, starting with the footer, and kept the animations. Every decision in section 14 waits for the owner. Frontend build starts only when the owner says so.

## 1. The idea

A ship survives a breach because it is built as compartments. Water that gets in floods one compartment and the walls hold. Bulkhead does the same with money, so the whole look is drawn from how a hull is built: steel plates, welded seams, compartments with a fill level, lime on the parts you operate, and hazard stripes on a door that is shut.

Meaning, in one sentence: damage stays where it starts.

## 1b. Logo

LOCKED. Supplied by the owner and redrawn as an exact vector on 21 November 2026. The owner confirmed the redraw on 21 November 2026. The geometry and colours are final: the file is copied, never retyped, traced, redrawn, simplified or replaced. Any change needs the owner's approval and a new hash.

![Bulkhead mark](brand/mark/bulkhead-mark.svg)

Meaning: four compartments held apart by seams around a sealed core. A breach floods one block and stops at the seam.

Geometry: a 7 by 7 grid, drawn at 10 units per cell (viewBox 70 by 70). Every vertex sits on a whole grid point and every diagonal is 45°. Four chamfered blocks arranged as a pinwheel around a 1 by 1 empty core, separated by 1-unit diagonal seams. One path, even-odd fill: the outline plus one inner cut-out.

Exact file (docs/brand/mark/bulkhead-mark.svg):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 70"><path fill="#0E2A13" fill-rule="evenodd" d="M0 0 0 20 10 30 0 30 0 50 20 70 40 70 40 60 50 70 70 70 70 50 60 40 70 40 70 20 50 0 30 0 30 10 20 0ZM30 10 40 20 40 30 50 30 60 40 50 40 40 30 40 40 30 40 40 50 40 60 30 50 30 40 20 40 10 30 20 30 30 40 30 30 40 30 30 20Z"/></svg>
```

SHA-256 of bulkhead-mark.svg: 7c81a3048ee24c502ae1284d880a6a4944c4bbbc6264fb352898a0be4afa6c68

Redraw check: rasterized at 512 px against the owner's image, 0.08% of pixels differ (the image's soft edges), 99.89% overlap. check_mark.py --strict passes. At 16 px the seams close up into a solid silhouette, which still reads; a small cut with wider seams may be needed for favicons.

Colours: Hull #0E2A13 on Lime #D8FFA6 (the owner's original), Lime on Hull (reversed), Hull on Bone. Colour variants change only the fill. Never other colours, gradients, outlines, shadows, or pulling the blocks apart.

Usage: the mark alone for the favicon, app icon and avatar. Lockup: the mark with "Bulkhead" as live text in Archivo, spacing to be confirmed in a browser. Emails use the PNG with alt text. The earlier concepts in docs/brand/concepts are retired.

Files: docs/brand/mark (ink and paper SVG, transparent PNG, 16, 32, 48, 180 and 512 px PNGs, a 1920 by 1080 frame).

## 2. The owner's rules (kept from earlier projects)

These are the owner's general rules, not Bell's look:

- 60/30/10 colour, never a near-white app.
- Consumer first: it should feel like a well-rated store app, never a hackathon dashboard.
- No screen confuses anyone: where am I, what's happening, what do I do next.
- Motion follows the chain: nothing shows as done before its transaction confirms.
- Every state is designed and screenshotted in light and dark, at phone and desktop width.
- No generic libraries: no component kits, icon packs, animation libraries or ready-made wallet modals.
- Numbers only from chain state, real units, real proof links.

## 3. Constraints specific to Bulkhead

- The worst case is always visible as a live number: "If your laptop were stolen now, the most it could take is 0.85 fUSD."
- Tightening is instant and widening is slow, and the UI shows the difference every time: tighten is one action on the laptop, widen always names the phone, the delay and when it takes effect.
- The laptop never shows a control that needs the Safety key without saying it goes to the phone.
- WCAG 2.2 AA, full keyboard access. The laptop app is desktop first, the phone view is phone first.

## 4. Colour

The palette comes from the owner's logo: its deep green and its lime.

### The split

- 60%, Bone #E7E2D8. Warm paper grey, the page and working area.
- 30%, Hull #0E2A13. The logo's deep green. Plates, the top bar, headings, the footer.
- 10%, Lime #D8FFA6. The logo's lime, used on the parts you operate: main button fills, the live fill in a compartment, the current navigation mark.

### Supporting and feedback colours

- Sheet #F3F0EA for inputs and insets. Ink 2 #4B5A55 for secondary text. On-Hull text #EEF0EA, on-Hull muted #A9B8AA. Lime Deep #3F5A12, the only lime tone allowed as text or a thin mark on Bone. Borders #6B756F.
- Success Kelp #1E6B45 (light Kelp #6FD3A0 on Hull), always with a tick and a word, because the brand is green too. Error Flood #B3261E (light #FF8C7E). Warning Rust #8C3B0A (light #F2A36B).

### Contrast (computed, WCAG)

Hull on Bone 12.0:1. Hull label on Lime 13.8:1. Lime on Hull 13.8:1. Lime Deep on Bone 6.1:1, on Sheet 6.9:1. On-Hull text 13.5:1, muted 7.4:1. Light Kelp, Flood and Rust on Hull 8.5, 6.8 and 7.5:1. On-Hull text on Kelp 5.6:1. Lime on Bone is only 1.2:1, so lime never sits on Bone as text or a thin mark: on Bone it is only a fill with a Hull label.

### Dark mode

Deep #071409 (60%), Dock #163A1E (30%), Lime unchanged (10%). Text on Deep 16.4:1, on Dock 11.0:1. Muted 9.1:1 on Deep, 6.1:1 on Dock. Lime on Dock 11.3:1. Light Kelp, Flood and Rust on Dock 6.9, 5.6 and 6.2:1. Borders #5E6B66, 3.4:1 on Deep. Follows the device, with a manual choice in the account sheet, applied before the first frame. The demo video is recorded in light.

## 5. Surfaces: plates and seams

Bulkhead has no signature corner. Its surfaces read as steel plates joined at seams.

- Plates: Hull surfaces with a small 6px radius on every corner, flat, no shadows. Industrial, not soft.
- Seams: plates that belong together sit with a 4px gap between them, like welded plates. The gap is the page colour showing through. A seam always means "these are parts of one thing": the compartments of one account, the before and after of one change.
- Weld line: a 1px line one step lighter than the plate (#24382F on Hull, #2A4A41 on Dock) runs 8px inside the top edge of each plate. It is the only decoration on a plate.
- Depth comes only from colour. No shadows anywhere, including sheets. A sheet is a plate on a dimmed page.
- Radii: 6px plates and buttons, 4px inputs, 2px chips.

## 6. The hull row (status)

The status object is a chart of the account, not the logo. Compartments sit in one row of plates joined by seams, each as wide as its share of the balance, with a minimum width.

Each compartment plate shows:

- Its name and what it holds, in wide Archivo numerals.
- A fill level: the plate's lower part fills in a lighter tone up to the balance.
- The blast radius bar along the bottom in Lime: what could leave right now.
- One sentence about its state.

States: Open, Spending (fill drops as a payment confirms), Paused by a watcher (dimmed, with the blocks left), Sealed (the hazard stripes from section 9 fill the compartment), Widening queued (a plate below the compartment: "Your phone approved a higher cap. It takes effect in 18 blocks. Tighten anything to cancel it."), Evacuated (the fill drains to the right and the plate shows the recovery receipt).

A request waiting on the phone is shown on the compartment it changes, as a small plate joined to it by a seam: "Waiting for your phone". There is no floating dock.

## 7. Animations (kept as approved)

These stay exactly as in the revision 1 preview:

- The fill level settles over 400ms when a payment confirms. The blast-radius bar shortens over 400ms.
- When a seal confirms, a Lime wall drops down the compartment's edge in 220ms with one small overshoot, and the stripes fill the compartment.
- Buttons sink while pressed (scale 0.97, darker fill) and spring back in 180ms. A button that sends a transaction keeps its size and becomes a progress bar with the real step. On success it turns Kelp with a 300ms tick, then becomes the next action. On failure it gives two small 6px shakes and shows the reason under it in Flood.
- Hold to approve on the phone: a ring fills around the phone glyph for 1 second, then the signature is made. Enter opens a confirm sheet instead.
- Numbers roll to their new value over 400ms. Every animation has a reduced-motion version that changes state without movement.

## 8. Buttons and controls

- Primary: a Lime plate, 52px tall on desktop, 56px on phone, Hull label 17px semibold with a 24px custom glyph. Behaviour from section 7.
- Secondary: a Hull plate with an On-Hull label (a Dock plate with a border in dark mode).
- Seal everything: a Hull plate with a striped Lime glyph. One tap, no confirm, because tightening is always safe.
- Break-glass: opens a sheet showing the pinned recovery address, then a primary button "Send everything to my recovery account".
- Proof: transaction hashes show as a mono hash on a small Sheet plate followed by "QoreScan", the whole plate is the link. Never underlined text.
- Quick actions on a receipt are a row of small plates joined by seams (Copy, QoreScan, Share), not round icon buttons.
- Caps are number fields with the unit and a live line under them: "The most anyone could take per payment: 5.00 fUSD".

## 9. Hazard stripes

Diagonal Lime and Hull stripes at 45°, 12px wide, used in exactly one place: a sealed compartment. They mean "this door is shut".

## 10. Status words and marks

Status uses words first, each with a small custom mark on a 16px grid, 2px strokes, square ends like plate edges: Holding (an open bar), Sealed (a striped square), Paused (a bar with a gap), Waiting for your phone (the phone glyph), Paid (a tick), Blocked by the chain (a bar with a stop), Evacuated (an arrow through an open bar).

## 11. Navigation and wayfinding

### Laptop app

- Top bar, a Hull plate: the lockup on the left, then the network readout "QoreChain testnet, block 10,462,080" updating live, which is where testnet is named, then the account button on the right.
- Navigation is a left rail of three plates joined by seams: Hull, Pay, Activity, with the current one marked by a Lime bar on its left. On narrow screens the rail becomes a row at the top.
- Every screen has a title, one sentence saying what's happening, and one main action.

### Phone safety view

One screen at a time. At rest it shows the hull row in miniature and "Nothing to approve." A request fills the screen: what changes as two plates joined by a seam (now and after), the delay, the transaction decoded by the Custody kit check, and the hold-to-approve control.

### Landing

- The hero is the attack replay, live: a stolen laptop key tries to drain a real testnet account, and the visitor watches the hull row seal and the chain refuse, with the real transactions listed beside it. One line above it: "Watertight walls inside your money." One main button: "Create my Bulkhead".
- Below it, "How the walls work": the three compartments explained as one hull row with real numbers from the demo account.
- No step cards.

### Setup

Setup builds the hull. Each choice adds to a hull row that grows on screen: your laptop key creates the Everyday compartment, pairing the phone adds Savings and its wall, setting the agent adds the Agent compartment, funding from QoreX fills them. The screen always shows what's left to build, as empty outlined compartments.

### Empty states

An empty compartment keeps its plate and shows its walls with no fill, plus one line and the action that fills it: "Savings is empty. Money here only leaves with your phone." with "Move money into Savings". No illustrations.

## 12. Footer: the hero footer (owner, 21 November)

The footer is a closing hero, the last thing a visitor sees and a second chance to start.

- A full-width Hull band (Dock in dark mode). Its top edge is straight, no cut corner, no silhouette, no photo.
- Headline in Archivo at its widest, 56 to 88px, weight 850, On-Hull text: "Damage stays where it starts."
- One line under it: "Watertight walls inside your money. Only the post-quantum key on your phone can move a wall."
- One main button, a Lime plate with a Hull label: "Create my Bulkhead". In the app it becomes the next useful action instead, for example "Pair your phone" if that step isn't done.
- A live line beside the button, read from the chain: on the landing page for the demo account, in the app for yours: "Right now the most anyone could take: 0.85 fUSD."
- Below, separated by a 1px weld-tone line: the mark at 24px with "Bulkhead" as live text, the links in one row (Hull, Pay, Activity, How it works, Help, Contracts and proof, Source code), then "QoreChain testnet. Use test funds only." and "© 2026 Bulkhead".
- No theme switch here, it lives in the account sheet. On phone the headline drops to 44px, the button goes full width and the links wrap.
- On desktop app screens the footer shows only its bottom row, so the closing hero doesn't repeat under every screen. The full hero footer is on the landing page and on Help.

## 13. Type, spacing and layout

- Archivo for everything (proposal), used wide (width 112 to 125) for headings and numbers, like deck signage, and normal width for body. OFL licence. Tabular figures must be confirmed in the font files before the build.
- IBM Plex Mono only for addresses and hashes.
- Rejected: Schibsted Grotesk (Bell's), Geist and Inter (defaults), Space Grotesk (overused in crypto).
- Scale: worst-case numbers 56px weight 850 wide, balances 36px, titles 30px, body 16px, labels 13px sentence case.
- 8px spacing grid. Plates have 24px padding on desktop, 16px on phone.
- Laptop app: desktop first at 1280px, content up to 1200px with the left rail. Phone view at 390px.

## 14. Decisions for the owner

- [x] Direction: the hull built from plates, seams and compartments.
- [x] Colour split: Bone 60, Hull 30, Lime 10, rust warnings.
- [x] Surfaces: plates with 6px radius, 4px seams, the weld line, no shadows.
- [x] Status: the hull row as a chart, separate from the logo.
- [x] Landing: the live attack replay as the hero.
- [x] Setup: building the hull, no step counter.
- [x] Navigation: left rail on the laptop, network readout in the top bar.
- [x] Typeface: Archivo with IBM Plex Mono.
- [x] Logo: supplied by the owner, redraw confirmed and locked (21 Nov).
- [x] Palette from the logo: Hull #0E2A13 and Lime #D8FFA6 (owner chose option a, 21 Nov).
- [x] Footer: hero footer (owner, 21 Nov).

## 15. Build and test rules

- Chain reads and writes through `@qorechain/sdk`, `@qorechain/evm` and viem. `@qorechain/react` for hooks only. QoreX through `@qorechain/qorex-types` with our own connect sheet.
- Self-hosted fonts. Native-first accessibility: native dialog for sheets, native radio fieldsets, native buttons with aria-busy, a polite live region for progress and an assertive one for errors.
- Before a screen is done: axe-core in Playwright, keyboard-only pass, TalkBack and VoiceOver, 200% zoom, reduced motion, 44px touch targets, screenshots in light and dark at both widths.

## 16. Screens and their UX (Phase 2)

Each screen lists its one job, what it shows first, its one main action, and the UX improvements over a typical wallet screen. Every screen also follows the rules in sections 2 and 3.

### 16.1 Landing

- Job: make a visitor understand damage-bounded money in ten seconds and start.
- First: the live attack replay. A stolen laptop key tries three things against a real testnet account (a big payment, a token approval, draining Savings), and each one fails on screen with its real transaction listed beside it.
- Main action: "Create my Bulkhead".
- UX improvements:
  - The replay starts on its own, muted of motion when reduced motion is on, and can be paused and stepped with the keyboard.
  - Every claim has a proof link next to it, so a judge never has to trust a sentence.
  - A visitor who scrolls past the replay sees the three compartments with real numbers, then the hero footer. No long marketing page.

### 16.2 Setup (building the hull)

- Job: get from nothing to a funded, phone-protected account without confusion.
- First: an empty hull outline with one sentence: "Let's build your hull. It takes about two minutes."
- Steps, each adding a piece of the hull on screen: create the laptop key (Everyday appears), pair the phone by QR (the Savings wall appears), set the walls with suggested values, fund from QoreX (the fill rises).
- UX improvements:
  - Suggested walls come from what the user plans to keep and spend, asked in plain words ("How much do you spend in a normal day?"), never as raw caps.
  - The user can leave at any step and come back to the same place. Progress is read from the chain, not from local storage.
  - Pairing shows both devices in one picture with a live "Phone connected" state, so the user knows the phone step worked before moving on.
  - Funding shows the exact QoreX request before the wallet opens: "QoreX will ask you to send 50.00 fUSD to your Bulkhead account."
  - The recovery account is part of setup, with a plain reason: "If you ever think you're hacked, everything goes here with one tap."

### 16.3 Hull (home)

- Job: answer "is my money safe and how much can I spend?" at a glance.
- First: the hull row, then one sentence: "Everything is holding. You can spend 4.20 fUSD more today."
- Main action: "Pay" (or "Unseal from my phone" when sealed).
- UX improvements:
  - The worst-case number sits above the fold on every width.
  - When something is wrong, the sentence and the main action change to fix it. The user never has to hunt for the problem.
  - "Seal everything" is always one tap away, in the same place.
  - Recent activity shows the last three items inline with a link to Activity, so home answers "what just happened?".

### 16.4 Pay

- Job: send money without fear of breaking a wall by accident.
- First: payee, amount, and the compartment it comes from, with a live check under the amount.
- Main action: "Pay" when inside the walls, "Ask my phone" when it would break a wall.
- UX improvements:
  - The check runs before sending: "Inside your walls" in Kelp, or "This is over your 5.00 limit, so it needs your phone" in Rust. The user never trips a tripwire by accident from the app. Tripwires are for stolen keys.
  - Recent payees appear as one-tap choices. A new payee says so: "First payment to this address."
  - Addresses are shown in groups of four characters and checked as the user types.
  - After paying, the screen shows the receipt in place with the proof link and the new blast radius.

### 16.5 Walls

- Job: change the walls with full understanding of what changes.
- First: each compartment's caps, floor, payees and watchers as plain sentences ("Up to 5.00 fUSD per payment, 15.00 per day").
- Actions: tightening is instant with one button; widening opens a sheet that says it goes to the phone and takes effect after the delay.
- UX improvements:
  - Every change shows its effect on the worst case before it's made: "Your worst case goes from 15.00 to 80.00 fUSD a day."
  - Tighten and widen are visibly different: tighten is a plain action, widen always shows the phone glyph and the delay.
  - Queued widenings show a countdown and a "Cancel" that is just a tighten, explained in one line.

### 16.6 Agent

- Job: let the user trust and supervise the bill agent.
- First: the agent's budget (its own account balance), its rule in plain words, and its last decisions.
- Main action: "Top up from my phone" or "Approve" for a waiting request.
- UX improvements:
  - Every decision shows the deterministic policy reason, not the model's text: "Paid: approved payee, 8.00 is within 10.00 per payment."
  - Blocked attempts are shown as the product working: "The chain blocked a 15.00 payment. Its rule allows 10.00."
  - Invoices show the payee and amount the policy read, with the raw invoice behind a disclosure, so injected text is never presented as an instruction.
  - "Pause agent" and "Revoke agent" are always visible.

### 16.7 Activity

- Job: show what happened, with proof.
- First: a list, newest first, grouped by day, each row with what, how much, which compartment and its state.
- UX improvements:
  - Filters by compartment and by "needs attention".
  - Each row opens a receipt with every on-chain step and its transaction hash plate.
  - Tripwires and blocked attempts are part of the history, so the user can see attacks that failed.

### 16.8 Phone safety view

- Job: approve or refuse widening safely, from the second device.
- First at rest: the hull row in miniature and "Nothing to approve."
- A request: what changes (now and after, joined by a seam), when it takes effect, who asked (the paired laptop), and the decoded transaction from the Custody kit check.
- Main action: hold to approve. Secondary: "Refuse", which also seals the affected compartment if the user didn't ask for it.
- UX improvements:
  - If the decoded transaction doesn't match the request, the approve control is removed and the screen says so.
  - "I didn't ask for this" is a first-class answer: it refuses and seals.
  - Break-glass is reachable from the phone at rest, behind the two-step sheet.
  - Requests expire visibly, with the time left.

### 16.8b Lost phone (Account settings and the phone)

- Laptop, Account settings: "Lost your phone?" Set up Bulkhead on a new phone, then enter its address. The account seals at once and the switch waits about three days (the account's safetyDelay, never shorter than its widening delay). The laptop can stop it; after the wait anyone can finish it, and only if the new phone's key is registered and proven.
- Old phone, if it still exists: a full-width alert "Someone is replacing this phone" with "Stop it, this phone stays", signed with the Safety key. A thief with the laptop alone gets a sealed account and a long, visible wait.
- After the switch the account stays sealed; the new phone unseals it with a normal widening.
- "I didn't ask for this" on the phone refuses the request and seals the account from the phone (sealWithApproval).

### 16.9 Attack replay

- Job: prove the walls hold, with real transactions.
- First: the scenario and the account's worst case before the attack.
- Steps: the stolen key pays over the cap (sealed, nothing moved), approves a token to a thief (blocked by scope), and tries Savings (refused). Each step has its real transaction.
- UX improvements: step-by-step with Next and Back, the hull row reacting at each step, and a closing line with the total lost: "0.00 fUSD left the account."

### 16.10 Contracts and proof

- Job: let anyone verify the contracts.
- Shows the factory and account addresses, read from the deployment record, with copy and explorer plates, the test network, and links to recent proof transactions.

### 16.11 Help

- Short answers to real questions (What is a blast radius? Why does my phone need to approve? What happens if I lose my phone?), then the full hero footer.
