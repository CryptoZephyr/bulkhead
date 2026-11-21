# Bulkhead design system (proposal)

Status: revision 2, 21 November 2026. Revision 1 reused eleven of Bell's specific inventions. The owner asked for all of them to be replaced, starting with the footer, and kept the animations. Every decision in section 14 waits for the owner. Frontend build starts only when the owner says so.

## 1. The idea

A ship survives a breach because it is built as compartments. Water that gets in floods one compartment and the walls hold. Bulkhead does the same with money, so the whole look is drawn from how a hull is built: steel plates, welded seams, compartments with a fill level, safety yellow on the parts you operate, and hazard stripes on a door that is shut.

Meaning, in one sentence: damage stays where it starts.

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

### The split

- 60%, Bone #E7E2D8. Warm paper grey, the page and working area.
- 30%, Hull #10211D. Deep green-black, the colour of a hull below the waterline. Plates, the top bar, headings, the footer.
- 10%, Hatch #E8A800. Marine safety yellow, used on the parts you operate: main button fills, the live fill in a compartment, the current navigation mark.

### Supporting and feedback colours

- Sheet #F3F0EA for inputs and insets. Ink 2 #4B5A55 for secondary text. On-Hull text #EEF0EA, on-Hull muted #A5B3AD. Hatch Deep #7A5300, the only Hatch tone allowed as text on Bone. Borders #6B756F.
- Success Kelp #1E6B45 (light Kelp #6FD3A0 on Hull). Error Flood #B3261E (light #FF8C7E). Warning Rust #8C3B0A (light #F2A36B), so warnings never compete with Hatch.

### Contrast (computed, WCAG)

Hull on Bone 12.9:1. Ink 2 on Bone 5.6:1. Hull label on Hatch 8.0:1. Hatch on Hull 8.0:1. Hatch Deep on Bone 5.3:1. On-Hull text on Hull 14.5:1, muted 7.7:1. Kelp, Flood and Rust on Bone 5.0, 5.1 and 5.9:1. Their light versions on Hull 9.1, 7.4 and 8.1:1. Borders 3.7:1 on Bone. Hatch on Bone is 1.4:1, so it is never used as text or a thin mark on Bone.

### Dark mode

Deep #0A1311 (60%), Dock #16302A (30%), Hatch unchanged (10%). Sheet #13211E, borders #5E6B66. Text on Deep 16.4:1, on Dock 12.3:1. Hatch on Dock 7.8:1. Follows the device, with a manual choice in the account sheet, applied before the first frame. The demo video is recorded in light.

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
- The blast radius bar along the bottom in Hatch: what could leave right now.
- One sentence about its state.

States: Open, Spending (fill drops as a payment confirms), Paused by a watcher (dimmed, with the blocks left), Sealed (the hazard stripes from section 9 fill the compartment), Widening queued (a plate below the compartment: "Your phone approved a higher cap. It takes effect in 18 blocks. Tighten anything to cancel it."), Evacuated (the fill drains to the right and the plate shows the recovery receipt).

A request waiting on the phone is shown on the compartment it changes, as a small plate joined to it by a seam: "Waiting for your phone". There is no floating dock.

## 7. Animations (kept as approved)

These stay exactly as in the revision 1 preview:

- The fill level settles over 400ms when a payment confirms. The blast-radius bar shortens over 400ms.
- When a seal confirms, a Hatch wall drops down the compartment's edge in 220ms with one small overshoot, and the stripes fill the compartment.
- Buttons sink while pressed (scale 0.97, darker fill) and spring back in 180ms. A button that sends a transaction keeps its size and becomes a progress bar with the real step. On success it turns Kelp with a 300ms tick, then becomes the next action. On failure it gives two small 6px shakes and shows the reason under it in Flood.
- Hold to approve on the phone: a ring fills around the phone glyph for 1 second, then the signature is made. Enter opens a confirm sheet instead.
- Numbers roll to their new value over 400ms. Every animation has a reduced-motion version that changes state without movement.

## 8. Buttons and controls

- Primary: a Hatch plate, 52px tall on desktop, 56px on phone, Hull label 17px semibold with a 24px custom glyph. Behaviour from section 7.
- Secondary: a Hull plate with an On-Hull label (a Dock plate with a border in dark mode).
- Seal everything: a Hull plate with a striped Hatch glyph. One tap, no confirm, because tightening is always safe.
- Break-glass: opens a sheet showing the pinned recovery address, then a primary button "Send everything to my recovery account".
- Proof: transaction hashes show as a mono hash on a small Sheet plate followed by "QoreScan", the whole plate is the link. Never underlined text.
- Quick actions on a receipt are a row of small plates joined by seams (Copy, QoreScan, Share), not round icon buttons.
- Caps are number fields with the unit and a live line under them: "The most anyone could take per payment: 5.00 fUSD".

## 9. Hazard stripes

Diagonal Hatch and Hull stripes at 45°, 12px wide, used in exactly one place: a sealed compartment. They mean "this door is shut".

## 10. Status words and marks

Status uses words first, each with a small custom mark on a 16px grid, 2px strokes, square ends like plate edges: Holding (an open bar), Sealed (a striped square), Paused (a bar with a gap), Waiting for your phone (the phone glyph), Paid (a tick), Blocked by the chain (a bar with a stop), Evacuated (an arrow through an open bar).

## 11. Navigation and wayfinding

### Laptop app

- Top bar, a Hull plate: the lockup on the left, then the network readout "QoreChain testnet, block 10,462,080" updating live, which is where testnet is named, then the account button on the right.
- Navigation is a left rail of three plates joined by seams: Hull, Pay, Activity, with the current one marked by a Hatch bar on its left. On narrow screens the rail becomes a row at the top.
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

## 12. Footer: the load plate

Ships carry a load plate that states what each part can safely take. Bulkhead's footer does the same for the account.

- A Hull band (Dock in dark mode) split into three plates joined by seams, so the footer itself is a hull row:
  - Left plate: the lockup and "Watertight walls inside your money."
  - Middle plate: the links as plain rows, grouped under small labels: Use (Hull, Pay, Activity), Learn (How it works, Help), Proof (Contracts and proof, Source code).
  - Right plate: the load reading. On the landing page it shows the demo account, in the app it shows yours: "Right now the most anyone could take: Everyday 0.85 fUSD, Agent 13.00 fUSD, Savings 0.00 fUSD." It updates live from the chain.
- Under the plates, one line: "QoreChain testnet. Use test funds only." and "© 2026 Bulkhead".
- No large logo, no silhouette, no theme switch (the theme choice lives in the account sheet).
- On phone the three plates stack, joined by horizontal seams.

## 13. Type, spacing and layout

- Archivo for everything (proposal), used wide (width 112 to 125) for headings and numbers, like deck signage, and normal width for body. OFL licence. Tabular figures must be confirmed in the font files before the build.
- IBM Plex Mono only for addresses and hashes.
- Rejected: Schibsted Grotesk (Bell's), Geist and Inter (defaults), Space Grotesk (overused in crypto).
- Scale: worst-case numbers 56px weight 850 wide, balances 36px, titles 30px, body 16px, labels 13px sentence case.
- 8px spacing grid. Plates have 24px padding on desktop, 16px on phone.
- Laptop app: desktop first at 1280px, content up to 1200px with the left rail. Phone view at 390px.

## 14. Decisions for the owner

- [ ] Direction: the hull built from plates, seams and compartments.
- [ ] Colour: Bone, Hull, Hatch, rust warnings.
- [ ] Surfaces: plates with 6px radius, 4px seams, the weld line, no shadows.
- [ ] Status: the hull row as a chart, separate from the logo.
- [ ] Footer: the load plate.
- [ ] Landing: the live attack replay as the hero.
- [ ] Setup: building the hull, no step counter.
- [ ] Navigation: left rail on the laptop, network readout in the top bar.
- [ ] Typeface: Archivo with IBM Plex Mono.
- [ ] Logo: choose from the concepts in docs/brand/concepts, or ask for new ones.

## 15. Build and test rules

- Chain reads and writes through `@qorechain/sdk`, `@qorechain/evm` and viem. `@qorechain/react` for hooks only. QoreX through `@qorechain/qorex-types` with our own connect sheet.
- Self-hosted fonts. Native-first accessibility: native dialog for sheets, native radio fieldsets, native buttons with aria-busy, a polite live region for progress and an assertive one for errors.
- Before a screen is done: axe-core in Playwright, keyboard-only pass, TalkBack and VoiceOver, 200% zoom, reduced motion, 44px touch targets, screenshots in light and dark at both widths.
