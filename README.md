# Noir Club — Blackjack

A private-table atmosphere in your browser: full-bleed emerald felt, ivory cards, brass details, and an original lounge soundtrack. No room, rail, dealer or player figures. Free play with virtual credits only.

[Play Noir Club](https://findahuman.github.io/noir-club-blackjack/)

![Noir Club blackjack table](docs/table-preview.jpg)

See the [mobile preview](docs/mobile-preview.jpg) and [initial-release verification report](docs/verification.md). Current checks run in [GitHub Actions](https://github.com/FinDaHuman/noir-club-blackjack/actions).

## Play

- Start with 2,500 credits. Select a chip or enter a wager of 10–500, in steps of 5.
- Hit, stand, double, or split a same-rank pair. Blackjack pays 3:2; the dealer stands on all 17s.
- One split per round, double after split allowed, split aces receive one card. Split 21 pays 1:1.
- Split hands play sequentially: finish hand 1 before hand 2 receives its next card. Split aces each receive a separately animated card with a pause before the dealer plays. This dealing order follows [New Jersey's blackjack procedure, §13:69F-2.11](https://www.nj.gov/oag/ge/docs/Regulations/CHAPTER69.pdf); table-specific split limits remain as stated above. Automatic dealing pauses while a dialog is open or the tab is hidden.
- Insurance is offered against an Ace before the dealer peeks: a half-bet side wager paying 2:1 on dealer blackjack. A ten-value upcard also triggers a visible peek.
- Late surrender returns half your original wager after blackjack has been ruled out, before hitting, doubling or splitting.
- Open **Learn** for a current-hand adviser, an interactive situation explorer, and hard-total, soft-total and pair strategy charts. Guidance uses six-deck S17/DAS/late-surrender basic strategy, with fallbacks for unavailable actions; it does not count cards or guarantee wins.
- Six decks shuffled with Web Crypto. Reshuffle between rounds below 80 cards.
- Open **Settings** in the top bar for independent music and sound-effect toggles and volume sliders, a sound preview, five dealing speeds (Slow, Relaxed, Normal, Quick, Fast), and reduced motion. The preview plays a card deal, chips, and a win chime at the selected effects volume, with visible playback or unavailable-audio feedback. Preferences persist on this device; existing audio preferences migrate automatically. Changes do not reset your game or stats.
- Desktop shortcuts default to Space to deal, H to hit, S to stand, D to double, P to split, and R to surrender. Customize each key in Settings, turn shortcuts off, or hide their hints. Duplicate bindings are rejected. Shortcuts do not run while typing, holding modifiers, repeating a key, or using a dialog. Mobile and touch devices hide shortcut hints and keyboard settings.
- Open the player tracker for cumulative net trends, win rate, streaks, blackjacks, surrender counts, insurance results and the last 100 rounds. Insurance is included in round net and total wagered. Surrenders count as losses. Export CSV or reset your session there.
- When your bankroll falls below the 10-credit minimum, choose **Continue playing → Add 2,500 · keep stats**. This preserves history, accuracy, streaks, and cumulative net: losses can continue below −2,500 across repeated bankruptcies. Refills and credits added are recorded separately and never count as winnings or affect the net-result chart. You can still choose to reset stats instead, with confirmation.
- **Basic-strategy accuracy lives only in the tracker.** See correctly played hands, decision accuracy, and expandable mistake reviews with the cards and dealer upcard at the time, your choice, the recommended action, and its explanation. Nothing is flagged during play. Accuracy updates after a round finishes and measures strategy, regardless of whether you won or lost.
- A hand is correct when every recorded choice is correct. Split hands are graded separately, with shared insurance/split choices counted once in decision accuracy. Recommendations respect available actions and credits. Hands with no choice and unaffordable insurance prompts are excluded. Older rounds and hands already underway before this feature are ungraded; tracking starts with newly dealt hands. Session totals persist beyond the last 100 rounds available for review. CSV exports include accuracy counts, and resetting the session resets accuracy.

The complete session, including an unfinished hand, persists in local storage on this browser and device. New visits start with an empty table; completed hands stay in the tracker, while unfinished hands resume. Older saved balances and stats are preserved. The game remains playable when storage is blocked, with a visible notice. Clearing browser storage clears progress. No account, backend, analytics, purchases, cash-out or real-money wagering.

## Development

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

React + TypeScript + Vite. Rules and accounting live in `src/game.ts`; audio is synthesized with the Web Audio API in `src/audio.ts`. All assets and fonts are served locally. No third-party runtime services are needed.

## Card visibility and mobile support

The felt is an independent background layer. The game fits a fixed dynamic viewport without page scrolling. Card size adapts to the actual space between the header and controls; short landscape screens place dealer and player hands side by side. Cards enter from a nearby point above their resting place, with visible overflow through the hand and table layers. Split-seat reflow never interpolates a card outside the newly narrowed hand. Settings, stats, rules, and strategy dialogs retain independent scrolling. Device and in-game reduced-motion preferences disable movement, while dealing speed keeps card animations and dealer pauses synchronized.

The test suite checks rules, accounting, strategy grading, saved-session upgrades, settings validation, and 500-round bankroll invariants, and exercises Chromium and WebKit. Accuracy checks cover split hands, insurance, unavailable actions, outcome-independent grades, completed-round-only display, tracker-only review, CSV export, persistence and reset. Bankruptcy checks cover preserved accuracy and history, losses beyond the initial bankroll, repeated refills, reloads, and deliberate resets. Browser tests sample card and face geometry during dealing, splitting, peeking and revealing to detect cards crossing the viewport or the control band, and check message clearance throughout settlement. Responsive checks cover widths from 320 to 1536 pixels, portrait and landscape, including 320×568 and 568×320. They assert that the page does not scroll and the controls remain inside the viewport. Settings tests exercise all six custom shortcuts, collisions, saved volumes and all five speeds, reduced motion, mobile hint visibility, and scrolling inside dialogs. Where Web Audio is available, preview tests measure a nonzero effects signal, test suspended/closed audio recovery, and verify mute/unmute; unavailable audio produces an in-panel explanation. Browser emulation does not replace a physical-device check.

## GitHub Pages

The `Verify and deploy Noir Club` workflow runs the tests and production build before uploading `dist` and deploying to Pages. Repository Settings → Pages must use **GitHub Actions** as its source. The Vite base path is relative, so assets work under a repository URL. The workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Art and audio

Felt and card-back textures were created for this project with the built-in image generator; optimized production files are in `public/assets`. The soundtrack and table effects are original procedural synthesis. The interface uses self-hosted DM Sans via Fontsource under the SIL Open Font License, with lining, tabular numerals for values. Card faces use the system Georgia serif for traditional printed ranks. Lucide icons use the ISC license. See `docs/assets.md` for the art brief and provenance.
