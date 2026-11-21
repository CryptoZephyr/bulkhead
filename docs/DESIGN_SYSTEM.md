# Bulkhead design system (proposal)

Status: revision 1, 21 November 2026. Written with the same method as Bell's design system, with Bulkhead's own identity. Nothing from Bell's look is reused: no Signal Orange, no 45° hook corner, no Schibsted Grotesk. Every decision in section 19 waits for the owner. Frontend build starts only when the owner says so.

## 0. Lessons carried from Seats and Bell

1. Every region has a colour role from day one, and the 60/30/10 split is checked on every screen. A near-white canvas is never allowed to take over.
2. The look must be recognisable at rest, not only in motion. A cropped screenshot of any screen should still read as Bulkhead.
3. The identity comes from the product's own idea. Bell's came from its two hooks. Bulkhead's comes from the bulkhead itself: a hull divided by watertight walls into compartments, where a breach floods one compartment and the walls hold.
4. The build agent screenshots every screen at phone and desktop width, in light and dark, in every state from section 14, and checks it against this page before calling it done. The owner reviews the built screens.

## 1. Constraints any design must respect

- No screen confuses the user. Every screen answers at a glance: where am I, what's happening, what do I do next.
- The worst case is always visible. Every compartment shows its blast radius as a live number from chain state: "The most anyone could take from Everyday right now: 0.85 fUSD."
- Numbers come only from chain state. A payment is never shown as done before its transaction confirms. Every proof link points to a real transaction.
- Animations follow the chain. A wall closes on screen only after the seal is confirmed on chain.
- Tighten is instant, widen is slow, and the UI shows it: tightening is one tap on the laptop, widening always shows the phone, the delay and a countdown to when it takes effect.
- Amounts use real units: QOR to 4 places, fUSD to 2 places. Raw base units never reach the screen.
- Testnet is findable (wallet tag and footer), never a banner.
- Two devices, two roles: the laptop app never shows a control that needs the Safety key without saying "Approve on your phone".
- WCAG 2.2 AA, full keyboard access, mobile first for the phone view, desktop first for the laptop app.

## 2. The design problem in one line

Every screen has to make three things obvious in two seconds: how much is in each compartment, the most anyone could take from it right now, and whether every wall is holding.

## 3. Who looks at Bulkhead, and what they need in two seconds

- First-time visitor: What is this? Why is it safer than my wallet? What do I press first?
- Owner on the laptop: How much can I spend today? Is anything sealed? Is my agent behaving?
- Owner on the phone: What am I being asked to approve, exactly? What changes if I say yes? When does it take effect?
- Owner after a tripwire: What happened, was anything lost, what do I do now?
- Judge watching the video: Is this real? Did the stolen key really fail? Where's the transaction?

## 4. Principles

1. The compartments are alive. Bulkhead's main visual is the hull: three compartments side by side, separated by walls. Each one fills with what's in it and shows how much of its blast radius is left. When a tripwire fires, the wall slams shut on screen as the seal confirms.
2. One next step, always visible. Every screen has exactly one main action.
3. Show the worst case, not a promise. The blast radius number replaces every "your funds are safe" claim.
4. The phone is the authority. Anything that widens a wall is drawn with the phone glyph and a delay countdown, so the two-device split is visible in the UI itself.
5. Receipts, not claims. Every action has a receipt with each on-chain step and an explorer link.
6. Refusals read as the product working: "The wall held. Nothing left your Savings."
7. Chain mechanics stay out of the main screens. Only "How this is protected" names ML-DSA-87, EVM windows, spending rules and precompiles.

### Banned

Blue or orange as a brand colour (blue reads as a chain brand, orange is Bell's), gradients as decoration, glass, blur, glow, neon, shields and padlock icons (every wallet uses them), vault doors and safes, particle or network backgrounds, terminal looks, confetti, generic spinners, shimmer skeletons, chain brand colours or logos as UI colour, emoji as icons, rocket or lightning icons, underlined text buttons, ghost buttons, unstyled browser controls, the words "safe wallet", "vault", "spending limits", "wallet with limits", "unhackable", "quantum-proof", "AI-powered", lorem ipsum, fake numbers.

Hazard stripes are banned everywhere except one place: a sealed compartment (section 8). That way they always mean one thing.

## 5. Navigation and wayfinding

### The rule

Nobody should ever ask "what now?". Every screen has a title, one sentence saying what's happening, and one main button.

### Laptop app shell

- Top bar: the lockup on the left, three tabs in the centre (Hull, Pay, Activity), the account button on the right with the small testnet tag.
- Hull is home: the three compartments, today's blast radius, and the agent's status.
- The phone dock: whenever a request waits on the phone, a small Hull card docks at the bottom of every screen: "Waiting for your phone: raise Everyday to 80 fUSD a day." Tapping it shows the request and its QR.

### Phone safety view

- One screen at a time, no tabs. At rest it shows the hull in miniature and "Nothing to approve."
- A request takes the whole screen: what changes (before and after), the delay, the decoded transaction from the Custody kit check, and one hold-to-approve control.

### First visit (landing)

- The hero is the living hull with three compartments, and the line: "Watertight walls inside your money. Only the post-quantum key on your phone can move a wall."
- Three step cards: Fund from QoreX, Pair your phone, Spend freely inside the walls.
- One main button "Create my Bulkhead", one secondary "Watch a stolen laptop fail", which plays the attack replay without a wallet.

### First-time guide

A step counter until setup is done: "Step 1 of 4: Create your laptop key", "Step 2 of 4: Pair your phone", "Step 3 of 4: Set your walls", "Step 4 of 4: Fund from QoreX". Finished steps collapse into ticks.

### Empty states

Every empty state has a picture, one sentence and a button. "Nothing in Savings yet. Money here only leaves with your phone." with "Move money into Savings".

## 6. Colour (60/30/10)

### The split

- 60%, Bone #E7E2D8. A warm paper grey, the page and main working area. Warm, so it never reads as Bell's cool Fog or a plain white app.
- 30%, Hull #10211D. A deep green-black, the colour of a ship's hull below the waterline. Structure and what matters most: compartment cards, the phone dock, the top bar, headings.
- 10%, Hatch #E8A800. Marine safety yellow, the colour of watertight door handles and deck markings. Main button fills, the live parts of the compartments, the selected tab mark.

### Supporting colours

- Sheet #F3F0EA: inputs and inset panels on Bone.
- Ink 2 #4B5A55: secondary text on Bone and Sheet.
- On-Hull text #EEF0EA and on-Hull muted #A5B3AD.
- Hatch Deep #7A5300: the only Hatch tone allowed as text or a thin mark on Bone and Sheet.
- Control borders #6B756F.

### Feedback colours (only for feedback)

- Success: Kelp #1E6B45 on light, light Kelp #6FD3A0 on Hull.
- Error: Flood #B3261E on light, light Flood #FF8C7E on Hull.
- Warning: Rust #8C3B0A on light, light Rust #F2A36B on Hull. Warning is rust, not amber, so it never competes with Hatch.

### Contrast (computed, WCAG)

Hull on Bone 12.9:1. Ink 2 on Bone 5.6:1. Hull label on Hatch 8.0:1. Hatch on Hull 8.0:1. Hatch Deep on Bone 5.3:1, on Sheet 6.0:1. On-Hull text 14.5:1. On-Hull muted 7.7:1. Kelp on Bone 5.0:1, On-Hull text on Kelp 5.6:1. Flood on Bone 5.1:1. Rust on Bone 5.9:1. Light Kelp, Flood and Rust on Hull 9.1, 7.4 and 8.1:1. Borders 3.7:1 on Bone, 4.2:1 on Sheet. Hatch on Bone is only 1.4:1, so Hatch never sits on Bone as text or a thin mark.

### Dark mode

Same roles and the same split, not the light mode inverted.

- 60%, Deep #0A1311. The page, green-black, never pure black.
- 30%, Dock #16302A. Compartment cards, the phone dock, the top bar. It stays green, so cards keep Bulkhead's colour.
- 10%, Hatch #E8A800, the same fill with a Hull label.
- Sheet #13211E, borders #5E6B66, text #EEF0EA, secondary #A5B3AD.

Contrast (computed): text on Deep 16.4:1, on Dock 12.3:1. Secondary 8.7:1 on Deep, 6.5:1 on Dock. Hatch on Deep 10.5:1, on Dock 7.8:1. Light Kelp, Flood and Rust on Dock 7.7, 6.2 and 6.9:1. Borders 3.4:1 on Deep.

Follows the device setting, with a System, Light, Dark choice in the account sheet, applied before the first frame. The demo video is recorded in light.

### Rules

- No screen is mostly Sheet or white. Bone is the base, and Hull is visible on every screen.
- If a screen looks yellow, there's too much Hatch.
- Labels on Hatch are always Hull, never white.

## 6b. Shape language: the wall (signature)

Bulkhead's surfaces are compartments, and compartments are separated by walls.

- The wall edge: every major Hull surface (compartment cards, the phone dock, primary buttons) has one thick straight edge, 6px on phone and 8px on desktop, in a tone one step lighter than the card (#2A3F39 in light mode, #2E4A42 in dark). The other three corners are rounded (20px on cards, 14px on buttons). Default: the wall is on the left edge, like a bulkhead seen from the side.
- The seam: compartments that sit side by side are separated by a 6px gap of Bone, with the wall edges facing each other. The hull row reads as one hull divided by walls.
- Where it applies: compartment cards, the phone dock, primary and secondary buttons, sheets' top edge, toasts.
- Where it doesn't: text inputs, chips, the tab marks, the app icon tile.
- Focus ring: 2px with a 2px gap, Hull in light mode, Hatch in dark mode, following the same shape.

## 6c. The hull row: compartments side by side

Things that are really compartments are laid out as one hull: Everyday, Savings and Agent side by side on desktop, stacked on phone, separated by seams. Their widths follow their balances, with a minimum width so a small compartment stays readable. Use it only for the compartments, never as decoration.

## 7. Buttons (reactive)

### Primary

- 56px on phone, 48px on desktop. Wall edge on the left, 14px radius elsewhere. Hatch fill, Hull label 17px semibold, a 24px custom glyph (the hull for "Create my Bulkhead", a wall for "Seal now", the phone for "Send to my phone").
- Press: sinks (scale 0.97, darker fill) while held, springs back in 180ms. The glyph moves: the wall drops, the phone buzzes once.
- Working: keeps its size and turns into a progress bar with the real step: "Opening a window for your account", "Sending to QoreChain", "Confirmed in 2 s".
- Success: fill turns Kelp, a tick draws in 300ms, the label says what happened, then the button becomes the next action.
- Failure: two small shakes, fill returns to Hatch, the reason shows under it in Flood with what to do.
- Not available: hidden, replaced by one line and the button that fixes it.

### Hold to approve (phone)

Every Safety-key approval is press and hold for 1 second. A ring fills around the phone glyph, and on release the ML-DSA-87 signature is made. Keyboard and screen-reader users press Enter, which opens a confirm sheet.

### Seal now

The one red-free emergency control: a Hull button with a Hatch wall glyph and "Seal everything". One tap, no confirm, because tightening is always safe. It shows on Hull and on every tripwire alert.

### Break-glass

"Send everything to my recovery account" sits behind a two-step sheet that shows the pinned recovery address, because it moves everything at once.

### Secondary, icon actions, choice controls, links

- Secondary: Hull fill with a Bone label (Dock with a border in dark mode), same shape and press behaviour, 48px.
- Icon actions: round 48px buttons on Sheet with a label underneath (Copy, Explorer, Share).
- Caps: a number field with the unit and a live line under it: "The most anyone could take per payment: 5.00 fUSD".
- Links: explorer chips with an arrow ("QoreScan ↗"), never underlined text.

## 8. Status, done the Bulkhead way

### The living hull

The hull row is the status object. Each compartment shows, always with a sentence:

- Open: a water line fills the compartment to its balance. Its blast-radius bar along the bottom shows how much the everyday key (or the agent) could still move: "Up to 0.85 fUSD can leave Everyday now."
- Spending: the water line drops as a payment confirms, and the blast-radius bar shortens.
- Paused by a sentinel: the compartment dims and shows the time left: "Paused by your watcher for 41 blocks. Nothing can leave."
- Sealed: the wall slams across the compartment, and the compartment fills with diagonal Hatch and Hull hazard stripes. "Sealed. A payment broke your walls, so nothing more can leave without your phone." This is the only place hazard stripes appear.
- Widening queued: a thin countdown runs along the wall with the phone glyph: "Your phone approved a higher cap. It takes effect in 18 blocks. Tighten anything to cancel it."
- Break-glass: the walls lift, and the water flows out to the right towards the recovery account, then the hull shows empty with the recovery receipt.

### The approval card (phone)

The request is a Hull card: what changes as a before and after, how long until it takes effect, and the decoded transaction from the Custody kit check: "You are signing: raise Everyday period cap from 15.00 to 80.00 fUSD. Account 0x7C66…59Be." If the decoded transaction doesn't match what the laptop asked for, the card turns Flood and refuses to sign.

### Custom status marks

Small custom marks, always with a word: Holding (a closed wall), Sealed (a wall with stripes), Paused (a wall with a clock), Waiting for phone (the phone glyph), Paid (a tick in a circle), Blocked by the chain (a wall with a stopped arrow), Evacuated (an arrow through an open wall).

## 9. Chain identity and the testnet tag

- QoreChain shows as the word "QoreChain" with a small custom mark, never QoreChain's own logo or brand colour as UI colour.
- Testnet: a small Rust "Testnet" tag in the account button. Footer: "Bulkhead runs on QoreChain testnet. Use test funds only."

## 9b. Footer: the hull section

- On the landing page and at the bottom of every desktop screen. On phone the same contents live in the account sheet.
- Signature: a large one-tone cross-section of a hull, cropped by the bottom edge, showing three compartments and two walls. Light mode: a Hull band with the section in #1A3530. Dark mode: a Dock band with the section in #21413A. Decorative, aria-hidden, never animates.
- Content: the lockup and "Watertight walls inside your money." App column (Hull, Pay, Activity), Learn (How it works, Help), Trust (Contracts and proof, Open source, since the repo is public). Theme switch, testnet line, "© 2026 Bulkhead". No hackathon links, no raw addresses.

## 10. Motion system

All motion is custom CSS and SVG, each with a reduced-motion version.

- Presses sink and spring back in 180ms.
- The hull: water lines settle over 400ms, a wall slams in 220ms with one small overshoot when a seal confirms, walls lift in 600ms for break-glass. This is Bulkhead's one big motion moment.
- Numbers roll to their new value over 400ms.
- Sheets rise with a spring. Tabs cross-fade in 150ms.

## 11. Loading states

- App start: the hull draws its walls one by one while reading the chain. "Reading your compartments from QoreChain."
- Content: skeletons shaped like the compartments, with a slow breathing fade. No shimmer.
- Waiting for the phone: the phone dock pulses its phone glyph slowly. After 30 s: "Open Bulkhead on your phone to see the request."
- Transaction confirming: the button's progress bar with a seconds counter.
- Delay running: the countdown along the wall, in blocks and in minutes.

## 12. Success states

- Payment sent: the button turns Kelp, the water line drops, the blast radius shortens.
- Phone paired: the phone glyph slides into the hull's corner and a tick draws.
- Wall widened: when the delay ends, the wall slides to its new place and the blast-radius number rolls up.
- Attack held (attack replay): the wall slams, stripes fill, and the line "The wall held. 0.00 fUSD left your Savings."

## 13. Error states

Every error says what happened, whether anything was lost, and the one thing to do next, next to what caused it.

- Tripwire fired: "A payment of 2.00 fUSD was over your 1.00 limit, so Everyday sealed itself. Nothing was sent." Buttons: "Unseal from my phone", "Send everything to recovery".
- Phone signature refused by the chain: "The chain rejected the approval. Nothing changed." with the reason.
- Decoded transaction mismatch on the phone: "This request doesn't match what your laptop asked for. Don't approve it." The approval control is removed.
- Window closed: "Your laptop's spending window has ended. Open a new one to keep paying." Button: "Open a window".
- Not enough QOR for gas: "You need a little QOR for gas." Button: "Top up from QoreX".
- Agent blocked by the chain: "Your bill agent tried to pay 15.00 fUSD to acme-hosting. Its rule allows 10.00 per payment, so the chain blocked it." Button: "Approve once from my phone".
- Chain unreachable: "We can't reach QoreChain right now. Your walls hold on chain without us. Retrying in 5 s."

## 14. State matrix (every one designed and screenshotted)

First visit. Setup steps 1 to 4. Phone not paired. Window closed, open, nearly spent. Compartment empty, open, spending, at its period cap, paused, sealed. Widening queued, cancelled by a tighten, taken effect. Phone request waiting, approved, rejected, decoded mismatch. Break-glass confirm, done. Agent idle, paying, blocked by the chain, waiting for approval, revoked. QoreX not installed, funding in progress, funded. Chain unreachable. Not enough gas. Attack replay: each step.

## 15. Build rules (no generic libraries)

- No component kits, icon packs, animation libraries or ready-made wallet modals. QoreX is connected through `@qorechain/qorex-types` with our own connect sheet.
- Chain reads and writes use `@qorechain/sdk`, `@qorechain/evm` and viem, which have no UI. `@qorechain/react` is used for its hooks only, never its components, so the look stays ours.
- Fonts are self-hosted.
- Accessibility is native-first: native dialog for sheets, native radio fieldsets for choices, native buttons with aria-busy, two live regions (polite for progress, assertive for errors), hold-to-approve with an Enter fallback.
- Testing before a screen is done: axe-core in Playwright, a keyboard-only pass, TalkBack and VoiceOver, 200% zoom, reduced motion, 44px touch targets.

## 16. Type, layout and shape

### Type

- Archivo for everything (proposal). A grotesque with a width axis from condensed to expanded, used at its wider widths for headings so it reads like ship and deck signage, and at normal width for body. OFL licence. Tabular figures must be confirmed in the font files before the build, as Bell's were.
- IBM Plex Mono only for addresses and transaction hashes.
- Rejected: Schibsted Grotesk (Bell's), Geist and Inter (hackathon defaults), Space Grotesk (overused in crypto).
- Blast-radius numbers 48 to 72px, weight 800, tabular. Balances 32 to 40px. Screen title 28px. Body 16px. Small 13px, sentence case.

### Layout

- Laptop app desktop first at 1280px, centred up to 1120px. Phone view at 390px.
- 4px spacing base. Cards: 20px padding on phone, 28px on desktop.
- Depth comes from colour: Hull cards on Bone. One soft shadow under rising sheets, nothing else.

## 17. Logo (to decide)

There is no Bulkhead logo yet. Proposed mark: a horizontal hull section, a rounded capsule divided by two vertical walls into three compartments, with the left compartment filled. It is the hull row in miniature, so the logo and the living status object are the same thing, the way Bell's hooks were. Ink on Bone and Bone on Hull, never in Hatch. If the owner supplies a logo instead, sections 6b, 8 and 9b are redrawn from it.

## 18. Screens

1. Landing: the living hull, the promise, three step cards, "Create my Bulkhead", "Watch a stolen laptop fail".
2. Setup: the four-step guide.
3. Hull (home): the hull row, today's blast radius, the agent card, "Seal everything".
4. Pay: payee, amount, the compartment it comes from and the live check "Inside your walls" or "Needs your phone".
5. Walls: caps, floor, payee list and watchers per compartment. Tighten is instant, widen sends to the phone.
6. Agent: the bill agent's budget, its rule, recent decisions with the policy reason, pending approvals.
7. Activity: receipts, newest first, with explorer chips.
8. Phone safety view: rest, request, hold to approve, done.
9. Attack replay: the stolen-laptop story step by step with real testnet transactions.
10. Contracts and proof: factory and account addresses, read from the deployment record.
11. Help.

## 19. Decisions for the owner

- [ ] Direction: the hull and its compartments as the identity.
- [ ] Colour: Bone, Hull, Hatch at 60/30/10, rust for warnings.
- [ ] Shape: the wall edge and the seam.
- [ ] Sealed state: hazard stripes, used only there.
- [ ] Typeface: Archivo with IBM Plex Mono.
- [ ] Logo: the proposed hull-section mark, or the owner supplies one.
- [ ] Light and dark mode, following the device.
- [ ] Hold to approve on the phone, 1 second.
- [ ] Footer: the hull-section silhouette.
