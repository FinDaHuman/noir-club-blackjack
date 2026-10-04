# Verification — 4 October 2026

## Gameplay and build

- 22 Vitest checks passed, including soft aces, 3:2 and fractional payouts, dealer naturals, pushes, busts, doubles, split rules, action locks, immutable state, unavailable storage, a complete six-deck shoe and a 500-round bankroll invariant.
- 26 Playwright checks passed against the production build in Chromium and WebKit. The final desktop sizing adjustment was checked again with six targeted browser checks.
- Browser checks cover complete rounds, split-hand progression, stats, CSV downloads, saved and unfinished sessions, editable wagers, reset confirmation, keyboard actions and reduced motion.
- Animation checks sample frames throughout dealing and splitting. They assert that cards stay within the horizontal viewport, above the controls, and outside clipping ancestors. A 19-card hand was also checked at 320 pixels wide.
- The first Linux CI run exposed throttled WebKit compositor callbacks (two frames in 2.4 seconds). The sampler now combines animation-frame callbacks with fresh layout measurements every 16ms and requires more than 30 samples; every geometry assertion is retained. CI runs one browser worker at a time to reduce rendering contention.
- Responsive dimensions: 320×667, 375×812, 390×844, 768×1024, 844×390, 1024×768 and 1536×1024.
- TypeScript and the Vite production build passed. Dependency audit: zero known vulnerabilities at verification time.

## Audio verification boundary

Chromium verified a running AudioContext and actual scheduled oscillator sources for the original soundtrack and table effects. Music and effects toggle separately and persist. The Windows Playwright WebKit port does not expose AudioContext; its test verified the visible fallback and working controls. Physical iOS/Android devices were not available. Audio begins after user interaction, and pauses when the document is hidden.

## Visual comparison

The built-in browser was used first to play a hand, inspect the table, and inspect the mobile tracker. Playwright then supplied repeatable frame sampling and screenshots. The generated concept and final production screenshot were both opened with `view_image`, at the concept's native 1536×1024 size. The mobile screenshot was also inspected.

| Comparison point       | Concept and implementation evidence                                     | Resolution                                                                       |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Fullscreen composition | Felt fills all four sides; no rail, room, hands or people               | Preserved                                                                        |
| Palette and materials  | Emerald wool, ivory paper, brass print, dark translucent controls       | Generated production felt and card back; preserved palette                       |
| Card scale and shadows | Dealer cards above, larger player cards below, physical contact shadows | Enlarged cards at tall desktop sizes; inspected rest, deal, split and reveal     |
| Typography             | Serif wordmark and table lettering; tracked sans-serif labels           | Self-hosted Cormorant Garamond and DM Sans; increased desktop label readability  |
| Layout and containers  | Open session stats, central hands, bottom control band                  | Preserved; fixed short-screen label/message overlap                              |
| Mobile behavior        | Same hierarchy with compact utilities and reachable controls            | Fixed wordmark wrapping; 390×844 fits exactly, short viewports scroll            |
| Motion and controls    | Card motion must never enter the table surface                          | Independent felt layer, visible-overflow card stage, inward-safe entry animation |

The implementation was verified against the concept's visual direction with the intentional adaptations below. No material clipping, overlapping controls or broken interactions remained in the checked states.

The WebKit screenshot review caught a compositing difference that rendered a rotated card back over the face. Card reveals now animate a single visible face with a timed edge-on swap, avoiding 3D backface compositing. Both browser screenshots and face/reveal assertions were checked again after this repair.

Above-the-fold copy audit: brand, rules, payouts, dealer and player labels, bankroll, denominations and actions are retained. Intentional additions are the current-turn message, virtual-credit label, fresh-seat greeting and private-table note. The idle screen uses “Your seat” and “Deal me in”; active play uses the four action buttons. The concept's illustrative 24 hands and 54% win rate are replaced by real zero-history stats.

Other intentional adaptations: accurate native card faces and stylized court cards; generated ornate card-back artwork; native chip controls; compact inline totals; responsive card spacing. These choices preserve accessible ranks, accurate pips and a usable mobile layout. The concept is a design reference, not a literal image embedded as an interface.

Published preview artifacts: [desktop](table-preview.jpg), [mobile](mobile-preview.jpg). Production image prompts and provenance: [assets](assets.md).
