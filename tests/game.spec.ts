import { expect, test, type Page } from '@playwright/test';
import { newGame, makeShoe, reducer, type Card, type Game } from '../src/game';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/settings';
const key = 'noir-club.game.v1';
async function seed(page: Page, ranks: string[], patch: Partial<Game> = {}) {
  const shoe: Card[] = ranks.map((rank, i) => ({ id: `seed-${i}`, rank, suit: 'spades' }));
  const game = { ...newGame([...shoe, ...makeShoe()]), ...patch };
  await page.addInitScript(({ key, game }) => localStorage.setItem(key, JSON.stringify(game)), {
    key,
    game,
  });
  await page.goto('./');
  await expect(page.locator('.app')).toHaveAttribute('data-phase', game.phase);
}
async function saved(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key) as Promise<Game>;
}
async function tracker(page: Page) {
  const mobile = page.getByRole('button', { name: 'Open player tracker' });
  if (await mobile.isVisible()) await mobile.click();
  else await page.getByRole('button', { name: 'View tracker' }).click();
}
async function assertViewport(page: Page) {
  expect(
    await page.evaluate(() => {
      const footer = document.querySelector('.control-deck')!.getBoundingClientRect();
      const controls = [
        ...document.querySelectorAll<HTMLElement>('.topbar button, .actions button, .chip, #wager'),
      ].filter((el) => el.getClientRects().length > 0);
      return {
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        viewport: [innerWidth, innerHeight],
        footerVisible: footer.bottom <= innerHeight + 1,
        controlsVisible: controls.every((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1
          );
        }),
      };
    }),
  ).toMatchObject({ footerVisible: true, controlsVisible: true });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Mobile WebKit does not implement wheel input; also attempt a programmatic page scroll.
  if (!test.info().project.use.isMobile) await page.mouse.wheel(0, 500);
  await page.evaluate(() => window.scrollTo(0, 500));
  expect(await page.evaluate(() => scrollY)).toBe(0);
}
async function monitorCards(page: Page, duration = 2400, protectHeader = false) {
  await page.bringToFront();
  await page.evaluate(
    ({ duration, protectHeader }) => {
      const monitor = { failures: [] as string[], samples: 0, done: false, duration };
      (window as any).__cardMonitor = monitor;
      const started = performance.now();
      let timer = 0;
      const measure = () => {
        monitor.samples++;
        const failures = monitor.failures;
        const footer = document.querySelector('.control-deck')!.getBoundingClientRect();
        const headerBottom = document.querySelector('.topbar')!.getBoundingClientRect().bottom;
        const ancestors = new Map<Element, { clips: boolean; bottom: number }>();
        if (document.querySelector<HTMLElement>('.app')!.dataset.phase === 'settled') {
          const message = document.querySelector('.table-message')!.getBoundingClientRect();
          if (message.bottom + 8 > footer.top)
            failures.push(
              `End-of-hand message too close to controls: ${footer.top - message.bottom}px`,
            );
        }
        document.querySelectorAll<HTMLElement>('.playing-card, .card-flipper').forEach((card) => {
          const r = card.getBoundingClientRect();
          if (protectHeader && r.top < headerBottom - 1)
            failures.push('Card animation overlaps header');
          if (r.left < -1 || r.right > innerWidth + 1 || r.bottom > footer.top + 1)
            failures.push(
              `Card outside safe table at sample ${monitor.samples}: ${JSON.stringify(r.toJSON())}`,
            );
          let parent = card.parentElement;
          while (parent && parent !== document.body) {
            let ancestor = ancestors.get(parent);
            if (!ancestor) {
              const clips = ['hidden', 'clip', 'scroll', 'auto'].includes(
                getComputedStyle(parent).overflowY,
              );
              ancestor = {
                clips,
                bottom: clips ? parent.getBoundingClientRect().bottom : Infinity,
              };
              ancestors.set(parent, ancestor);
            }
            if (ancestor.clips && ancestor.bottom < r.bottom - 1)
              failures.push(`Clipped by ${parent.className}`);
            parent = parent.parentElement;
          }
        });
        if (performance.now() - started >= duration) {
          monitor.done = true;
          clearInterval(timer);
        }
      };
      // One sampler avoids duplicate forced layout work on software-rendered WebKit.
      // Publish progress continuously, and finish from elapsed time rather than a second timer.
      timer = window.setInterval(measure, 32);
      measure();
    },
    { duration, protectHeader },
  );
}
async function assertMotion(page: Page) {
  const duration = await page.evaluate(() => (window as any).__cardMonitor.duration);
  await expect
    .poll(() => page.evaluate(() => (window as any).__cardMonitor.done), {
      timeout: duration + 5000,
    })
    .toBe(true);
  expect(await page.evaluate(() => (window as any).__cardMonitor.samples)).toBeGreaterThan(30);
  expect(await page.evaluate(() => (window as any).__cardMonitor.failures)).toEqual([]);
}
async function assertHandClearance(page: Page) {
  const collisions = await page.evaluate(() => {
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    const message = document.querySelector('.table-message')!.getBoundingClientRect();
    return [...document.querySelectorAll('.hand')].flatMap((hand) => {
      const cards = [...hand.querySelectorAll('.playing-card')].map((card) =>
        card.getBoundingClientRect(),
      );
      const status = hand.querySelector('.hand-status')?.getBoundingClientRect();
      return [
        ...(cards.some((r) => r.top < header.bottom - 1) ? ['Card overlaps header'] : []),
        ...(status && status.bottom > message.top - 2 ? ['Hand label overlaps message'] : []),
      ];
    });
  });
  expect(collisions).toEqual([]);
}
test('deal, double, settlement, tracker, CSV and reload persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, ['5', '10', '6', '7', 'K']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Double', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await expect(page.locator('.dealer-hand .card-back')).toHaveCount(0);
  await expect(page.locator('.dealer-hand .card-face')).toHaveCount(2);
  expect((await saved(page)).balance).toBe(2600);
  await tracker(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('cell', { name: '+100', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('noir-club-history.csv');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Remove seeding on navigation by opening a second page in the same browser context.
  const restored = await page.context().newPage();
  await restored.goto('./');
  expect((await saved(restored)).balance).toBe(2600);
  await restored.close();
  expect(errors).toEqual([]);
});
test('split hands remain above felt and inside the safe table during animation', async ({
  page,
}) => {
  await seed(page, ['8', '10', '8', '7', '2', '3', '5']);
  await monitorCards(page);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await assertMotion(page);
  await expect(page.locator('.player-hand .card-face')).toHaveCount(2);
  await expect(page.locator('.player-hand .card-back')).toHaveCount(0);
  await expect(page.locator('.dealer-hand .card-back')).toHaveCount(1);
  await monitorCards(page);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await assertMotion(page);
  await expect(page.locator('.player-hand')).toHaveCount(2);
  await page.getByRole('button', { name: 'Hit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  expect((await saved(page)).stats.hands).toBe(2);
});
test('audio creates running output and independent settings persist', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    (window as any).__contexts = [];
    (window as any).__oscillatorsStarted = 0;
    (window as any).__audioOutputs = [];
    if (Original) {
      window.AudioContext = class extends Original {
        constructor() {
          super();
          (window as any).__contexts.push(this);
        }
        createOscillator() {
          const osc = super.createOscillator();
          const start = osc.start.bind(osc);
          osc.start = (when?: number) => {
            (window as any).__oscillatorsStarted++;
            start(when);
          };
          return osc;
        }
        createGain() {
          const gain = super.createGain();
          const connect = gain.connect.bind(gain);
          gain.connect = ((destination: AudioNode) => {
            if (destination === this.destination) (window as any).__audioOutputs.push(gain);
            return connect(destination);
          }) as typeof gain.connect;
          return gain;
        }
      };
    }
  });
  await seed(page, ['10', '9', '8', '8']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  if (await page.evaluate(() => typeof AudioContext !== 'undefined')) {
    await expect
      .poll(() => page.evaluate(() => (window as any).__contexts[0]?.state))
      .toBe('running');
    await expect
      .poll(() => page.evaluate(() => (window as any).__oscillatorsStarted))
      .toBeGreaterThan(3);
  } else {
    // Playwright's Windows WebKit port has no Web Audio API; verify graceful fallback.
    await expect(
      page.getByText('Audio is unavailable in this browser. You can still play.'),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('checkbox', { name: 'Background music', exact: true }).uncheck();
  await expect(
    page.getByRole('checkbox', { name: 'Background music', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Sound effects', exact: true }).uncheck();
  if (await page.evaluate(() => typeof AudioContext !== 'undefined')) {
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__audioOutputs.every((node: GainNode) => node.gain.value < 0.001),
        ),
      )
      .toBe(true);
  }
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SETTINGS_KEY),
  ).toMatchObject({
    effects: false,
    music: false,
  });
  await page.getByRole('checkbox', { name: 'Background music', exact: true }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Sound effects', exact: true }),
  ).not.toBeChecked();
  if (await page.evaluate(() => typeof AudioContext !== 'undefined')) {
    const volume = page.getByRole('slider', { name: 'Background music volume' });
    await volume.press('Home');
    for (let i = 0; i < 4; i++) await volume.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => (window as any).__audioOutputs[0].gain.value))
      .toBeCloseTo(0.04, 3);
    expect(await page.evaluate(() => (window as any).__audioOutputs[1].gain.value)).toBeLessThan(
      0.001,
    );
  }
});
test('bet typing, rules dialog, keyboard and reset confirmation', async ({ page }) => {
  await seed(page, ['10', '9', '8', '8']);
  await page.getByRole('spinbutton', { name: 'Bet amount' }).fill('125');
  await page.getByRole('spinbutton', { name: 'Bet amount' }).press('Tab');
  expect((await saved(page)).bet).toBe(125);
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('The house rules');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await tracker(page);
  await page.getByRole('button', { name: 'Reset session' }).click();
  await expect(page.getByRole('dialog')).toContainText('A fresh start?');
  await page.getByRole('button', { name: 'Keep my session' }).click();
  expect((await saved(page)).stats.rounds).toBe(1);
  await page.getByRole('button', { name: 'Reset session' }).click();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  expect((await saved(page)).balance).toBe(2500);
  expect((await saved(page)).history).toHaveLength(0);
});
test('keyboard play, unfinished-hand recovery and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page, ['5', '10', '6', '7', '3']);
  // Establish normal page focus after React has rendered, before sending a raw key.
  await page.getByRole('main', { name: 'Blackjack table' }).click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Hit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  const balance = (await saved(page)).balance;
  const restored = await page.context().newPage();
  await restored.emulateMedia({ reducedMotion: 'reduce' });
  await restored.goto('./');
  expect((await saved(restored)).phase).toBe('player');
  expect((await saved(restored)).balance).toBe(balance);
  expect((await saved(restored)).hands[0].cards).toHaveLength(3);
  // A focused action button must not swallow letter shortcuts.
  await restored.getByRole('button', { name: 'Hit', exact: true }).focus();
  await restored.keyboard.press('s');
  await expect(restored.locator('.app')).toHaveAttribute('data-phase', 'settled');
  expect(
    await restored
      .locator('.playing-card')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration)),
  ).toBeLessThanOrEqual(0.001);
  await restored.close();
});
test('a long hand fans without escaping the mobile table', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  const longHand: Card[] = Array.from({ length: 18 }, (_, i) => ({
    id: `ace-${i}`,
    rank: 'A',
    suit: 'hearts',
  }));
  await seed(page, ['2', '10'], {
    phase: 'player',
    balance: 2450,
    dealer: [
      { id: 'dealer-1', rank: '10', suit: 'spades' },
      { id: 'dealer-2', rank: '7', suit: 'diamonds' },
    ],
    hands: [{ cards: longHand, bet: 50, stood: false, split: false }],
  });
  await monitorCards(page);
  await page.getByRole('button', { name: 'Hit', exact: true }).click();
  await assertMotion(page);
  expect((await saved(page)).hands[0].cards).toHaveLength(19);
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'player');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const [width, height] of [
  [320, 568],
  [320, 667],
  [375, 812],
  [390, 844],
  [768, 1024],
  [844, 390],
  [667, 375],
  [568, 320],
  [1024, 768],
  [1536, 1024],
  [1366, 768],
]) {
  test(`responsive ${width}x${height}: controls, assets and card clearance`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seed(page, ['8', '10', '8', '7', '2', '3']);
    await expect(page.getByRole('button', { name: 'Deal me in' })).toBeVisible();
    await assertViewport(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('.players-area .hand-label').evaluateAll((labels) => {
        const message = document.querySelector('.table-message')!.getBoundingClientRect();
        return labels.every((label) => {
          const r = label.getBoundingClientRect();
          return r.bottom <= message.top || r.right <= message.left || r.left >= message.right;
        });
      }),
    ).toBe(true);
    expect(
      await page.locator('.felt').evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain('felt.webp');
    await monitorCards(page);
    await page.getByRole('button', { name: 'Deal me in' }).click();
    await assertMotion(page);
    await assertViewport(page);
    await monitorCards(page);
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await assertMotion(page);
    await assertViewport(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.qa/${test.info().project.name}-${width}x${height}.png`,
      fullPage: true,
    });
  });
}

test('opening is empty, totals use legible numerals, and completed cards clear on reopen', async ({
  page,
}) => {
  await seed(page, ['9', '10', '7', '8']);
  await expect(page.locator('.playing-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'peeking');
  await expect(page.locator('.is-peeking')).toHaveCount(1);
  await expect(page.locator('.dealer-hand .card-back')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Surrender', exact: true })).toBeEnabled();
  expect(
    await page.locator('.player-hand .score').evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('DM Sans');
  await page.getByRole('button', { name: 'Surrender', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  expect((await saved(page)).balance).toBe(2475);
  const reopened = await page.context().newPage();
  await reopened.goto('./');
  await expect(reopened.locator('.app')).toHaveAttribute('data-phase', 'betting');
  await expect(reopened.locator('.playing-card')).toHaveCount(0);
  expect((await saved(reopened)).history[0].results).toEqual(['surrender']);
  await reopened.close();
});

test('Ace insurance precedes a visible safe peek and settles a dealer blackjack', async ({
  page,
}) => {
  await seed(page, ['9', 'A', '7', 'K']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'insurance');
  await expect(page.locator('.is-peeking')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Insure · 25', exact: true })).toBeEnabled();
  await monitorCards(page);
  await page.getByRole('button', { name: 'Insure · 25', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'peeking');
  await expect(page.locator('.is-peeking')).toHaveCount(1);
  await expect(page.locator('.dealer-hand .card-back')).toHaveCount(1);
  expect(
    await page.locator('.is-peeking').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('dealer-peek');
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await assertMotion(page);
  await expect(page.locator('.dealer-hand .card-face')).toHaveCount(2);
  expect(await saved(page)).toMatchObject({ balance: 2500, stats: { insuranceNet: 50, net: 0 } });
  await tracker(page);
  await expect(page.getByText('Insurance +50', { exact: true })).toBeVisible();
});

test('declined insurance persists across reopening and surrender stays unavailable after a hit', async ({
  page,
}) => {
  await seed(page, ['5', 'A', '6', '6', '2']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'insurance');
  const reopened = await page.context().newPage();
  await reopened.goto('./');
  await expect(reopened.locator('.app')).toHaveAttribute('data-phase', 'insurance');
  await reopened.getByRole('button', { name: 'No insurance', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await reopened.getByRole('button', { name: 'Hit', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await expect(reopened.getByRole('button', { name: 'Surrender', exact: true })).toBeDisabled();
  expect((await saved(reopened)).insuranceBet).toBe(0);
  await reopened.close();
});

test('strategy room explores all charts, fallback actions and the live hand without console errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, ['8', '10', '8', '7']);
  await page.getByRole('button', { name: 'Learn basic strategy' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.strategy-answer h3')).toHaveText('Surrender');
  await page.getByRole('combobox', { name: 'Hand stage', exact: true }).selectOption('hit');
  await expect(page.locator('.strategy-answer h3')).toHaveText('Hit');
  await page.getByRole('button', { name: 'Soft totals', exact: true }).click();
  await page.getByRole('combobox', { name: 'Hand stage', exact: true }).selectOption('original');
  await page.getByRole('combobox', { name: 'Dealer upcard', exact: true }).selectOption('6');
  await expect(page.locator('.strategy-answer h3')).toHaveText('Double');
  await page.getByLabel('Credits for double / split').uncheck();
  await expect(page.locator('.strategy-answer h3')).toHaveText('Stand');
  await page.getByRole('button', { name: 'Pairs', exact: true }).click();
  await page.getByLabel('Credits for double / split').check();
  await page.getByRole('combobox', { name: 'Dealer upcard', exact: true }).selectOption('10');
  await expect(page.locator('.strategy-answer h3')).toHaveText('Split');
  await page.getByRole('combobox', { name: 'Your hand', exact: true }).selectOption('3');
  await page.getByRole('combobox', { name: 'Dealer upcard', exact: true }).selectOption('6');
  await page.getByRole('combobox', { name: 'Hand stage', exact: true }).selectOption('split');
  await expect(page.locator('.strategy-answer h3')).toHaveText('Split');
  await page.getByRole('combobox', { name: 'Hands on the table', exact: true }).selectOption('3');
  await expect(page.locator('.strategy-answer h3')).toHaveText('Split');
  await page.getByRole('combobox', { name: 'Hands on the table', exact: true }).selectOption('4');
  await expect(page.locator('.strategy-answer h3')).toHaveText('Hit');
  await page.getByRole('combobox', { name: 'Your hand', exact: true }).selectOption('11');
  await expect(page.locator('.strategy-answer h3')).toHaveText('One card only');
  await page.getByRole('button', { name: 'pair 9, 9 versus 7: Stand', exact: true }).click();
  await expect(page.locator('.strategy-answer h3')).toHaveText('Stand');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Learn basic strategy' }).click();
  await expect(page.locator('.live-advice h3')).toHaveText('Split');
  expect(errors).toEqual([]);
});

test('accuracy and mistake review stay in the tracker and include only completed rounds', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, ['10', '6', '2', '10', '2', '5']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Hit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await expect(page.locator('.accuracy-stats')).toHaveCount(0);
  await expect(page.getByText(/mistake|accuracy|you chose/i)).toHaveCount(0);
  await tracker(page);
  await expect(page.locator('.accuracy-hand-count')).toHaveText('0 of 0 graded hands');
  await expect(page.locator('.accuracy-decision-count')).toHaveText('0 of 0 decisions correct');
  await expect(page.locator('.accuracy-pending')).toBeVisible();
  await expect(page.locator('.accuracy-review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await expect(page.locator('.accuracy-stats')).toHaveCount(0);
  await expect(page.getByText(/mistake|accuracy|you chose/i)).toHaveCount(0);
  await tracker(page);
  await expect(page.locator('.accuracy-hand-count')).toHaveText('0 of 1 graded hands');
  await expect(page.locator('.accuracy-hand-rate')).toHaveText('0%');
  await expect(page.locator('.accuracy-decision-count')).toHaveText('1 of 2 decisions correct');
  await expect(page.locator('.accuracy-decision-rate')).toHaveText('50%');
  await page.locator('.accuracy-review summary').click();
  await expect(page.locator('.decision-review-list li')).toHaveCount(1);
  await expect(page.locator('.decision-cards')).toContainText('10♠ 2♠');
  await expect(page.locator('.decision-cards')).not.toContainText('10♠ 2♠ 2♠');
  await expect(page.locator('.decision-comparison dd')).toHaveText(['Hit', 'Stand']);
  expect(
    await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.split('\n')[0]).toContain(
    'Strategy decisions,Correct decisions,Graded hands,Correct hands',
  );
  expect(csv.split('\n')[1]).toMatch(/,2,1,1,0$/);
  const reopened = await page.context().newPage();
  await reopened.goto('./');
  await tracker(reopened);
  await expect(reopened.locator('.accuracy-decision-rate')).toHaveText('50%');
  await expect(reopened.locator('.accuracy-hand-count')).toHaveText('0 of 1 graded hands');
  await reopened.getByRole('button', { name: 'Reset session' }).click();
  await reopened.getByRole('button', { name: 'Start fresh' }).click();
  await tracker(reopened);
  await expect(reopened.locator('.accuracy-hand-rate')).toHaveText('—');
  await expect(reopened.locator('.accuracy-review')).toHaveCount(0);
  await reopened.close();
  expect(errors).toEqual([]);
});

test('tracker grades split hands separately without duplicating the split decision', async ({
  page,
}) => {
  await seed(page, ['8', '6', '8', '10', '3', '10', '2', '5']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Double', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await tracker(page);
  await expect(page.locator('.accuracy-hand-count')).toHaveText('1 of 2 graded hands');
  await expect(page.locator('.accuracy-hand-rate')).toHaveText('50%');
  await expect(page.locator('.accuracy-decision-count')).toHaveText('2 of 3 decisions correct');
  await expect(page.locator('.accuracy-decision-rate')).toHaveText('66.7%');
  await page.locator('.accuracy-review summary').click();
  await expect(page.locator('.hand-grades')).toHaveText('Hand 1: correct · Hand 2: needs review');
  await expect(page.locator('.decision-context b')).toHaveText('Hand 2');
  await expect(page.locator('.decision-comparison dd')).toHaveText(['Stand', 'Double']);
});

test('older saved rounds remain ungraded while newly dealt hands count', async ({ page }) => {
  const cards = (ranks: string[]): Card[] =>
    ranks.map((rank, i) => ({ id: `legacy-${i}`, rank, suit: 'spades' }));
  let game = newGame([...cards(['10', '8', '9', '9']), ...makeShoe()]);
  for (const type of ['DEAL', 'READY', 'STAND', 'DEALER_TICK'] as const)
    game = reducer(game, { type });
  expect(game.phase).toBe('settled');
  const old = JSON.parse(JSON.stringify(game));
  delete old.accuracy;
  old.hands.forEach((hand: { decisionIds?: number[] }) => delete hand.decisionIds);
  old.history.forEach((round: { accuracy?: unknown }) => delete round.accuracy);
  for (const field of [
    'strategyDecisions',
    'strategyCorrectDecisions',
    'strategyHands',
    'strategyCorrectHands',
  ])
    delete old.stats[field];
  old.shoe = [...cards(['9', '10', '7', '8']), ...makeShoe()];
  await page.addInitScript(({ key, old }) => localStorage.setItem(key, JSON.stringify(old)), {
    key,
    old,
  });
  await page.goto('./');
  await tracker(page);
  await expect(page.locator('.accuracy-hand-rate')).toHaveText('—');
  await expect(page.locator('.accuracy-hand-count')).toHaveText('0 of 0 graded hands');
  await expect(page.getByRole('cell', { name: 'Ungraded', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Surrender', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Surrender', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await tracker(page);
  await expect(page.locator('.accuracy-hand-count')).toHaveText('1 of 1 graded hands');
  await expect(page.locator('.accuracy-decision-rate')).toHaveText('100%');
  expect(await saved(page)).toMatchObject({ balance: 2525, stats: { hands: 2 } });
});

test('split aces deal one at a time, pause for review, and remain clear of the controls', async ({
  page,
}) => {
  await seed(page, ['A', '6', 'A', '10', 'K', '9', '5']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeEnabled();
  await monitorCards(page, 6500);
  await page.evaluate(() => {
    const events: { phase: string; counts: number[]; time: number }[] = [];
    (window as any).__splitEvents = events;
    let last = '';
    new MutationObserver(() => {
      const phase = document.querySelector('.app')!.getAttribute('data-phase')!;
      const counts = [...document.querySelectorAll('.player-hand')].map(
        (h) => h.querySelectorAll('.playing-card').length,
      );
      const key = phase + counts.join(',');
      if (key !== last) {
        events.push({ phase, counts, time: performance.now() });
        last = key;
      }
    }).observe(document.querySelector('.app')!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    });
  });
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'splitting');
  await expect(page.locator('.player-hand').nth(0).locator('.playing-card')).toHaveCount(1);
  await expect(page.locator('.player-hand').nth(1).locator('.playing-card')).toHaveCount(1);
  await tracker(page);
  const paused = await saved(page);
  await page.waitForTimeout(1300); // Longer than a dealing step: the dialog must pause progression.
  expect(await saved(page)).toEqual(paused);
  expect((await saved(page)).history).toHaveLength(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'split-dealing');
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeDisabled();
  await expect(page.locator('.player-hand').nth(1).locator('.playing-card')).toHaveCount(2);
  await expect(page.locator('.dealer-hand .card-back')).toHaveCount(1);
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  const events = (await page.evaluate(() => (window as any).__splitEvents)) as {
    phase: string;
    counts: number[];
    time: number;
  }[];
  const first = events.find((e) => e.phase === 'split-dealing' && e.counts.join() === '2,1')!;
  const second = events.find((e) => e.phase === 'split-dealing' && e.counts.join() === '2,2')!;
  const dealer = events.find((e) => e.phase === 'dealer')!;
  expect(second.time - first.time).toBeGreaterThanOrEqual(900);
  expect(dealer.time - second.time).toBeGreaterThanOrEqual(900);
  expect((await saved(page)).stats).toMatchObject({
    hands: 2,
    blackjacks: 0,
    strategyDecisions: 1,
    strategyCorrectHands: 2,
  });
  await assertMotion(page);
});

const settledCases = [
  { name: 'blackjack', player: [['A', 'K']], dealer: ['9', '9'], labels: ['BLACKJACK'] },
  { name: 'win', player: [['10', '10']], dealer: ['10', '8'], labels: ['WIN'] },
  { name: 'loss', player: [['10', '8']], dealer: ['10', '10'], labels: ['LOSS'] },
  { name: 'push', player: [['10', '8']], dealer: ['10', '8'], labels: ['PUSH'] },
  { name: 'bust', player: [['10', '8', '6']], dealer: ['10', '10'], labels: ['BUST'] },
  { name: 'surrender', player: [['9', '7']], dealer: ['10', '8'], labels: ['SURRENDER'] },
  { name: 'insurance', player: [['9', '7']], dealer: ['A', 'K'], labels: ['LOSS'] },
  {
    name: 'split',
    player: [
      ['10', '9'],
      ['9', '8'],
    ],
    dealer: ['10', '8'],
    labels: ['WIN', 'LOSS'],
  },
];
for (const [width, height] of [
  [320, 667],
  [390, 844],
  [844, 390],
]) {
  test(`every hand result has clear labels and messages at ${width}x${height}`, async ({
    context,
  }) => {
    test.setTimeout(60000);
    for (const sample of settledCases) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height });
      const cards = (ranks: string[], prefix: string): Card[] =>
        ranks.map((rank, i) => ({ id: `${prefix}-${i}`, rank, suit: 'hearts' }));
      const game: Game = {
        ...newGame(),
        phase: 'dealer',
        bet: 500,
        balance: 14500,
        dealer: cards(sample.dealer, 'dealer'),
        insuranceBet: sample.name === 'insurance' ? 250 : 0,
        hands: sample.player.map((ranks, i) => ({
          cards: cards(ranks, `hand${i}`),
          bet: 500,
          stood: true,
          split: sample.player.length > 1,
          ...(sample.name === 'surrender' ? { result: 'surrender' as const } : {}),
        })),
      };
      await page.addInitScript(({ key, game }) => localStorage.setItem(key, JSON.stringify(game)), {
        key,
        game,
      });
      await page.goto('./');
      await monitorCards(page, 1400);
      await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
      await expect(page.locator('.hand-result')).toHaveText(sample.labels);
      await assertMotion(page);
      await assertViewport(page);
      await assertHandClearance(page);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const message = rect('.table-message'),
          footer = rect('.control-deck');
        const results = [...document.querySelectorAll('.hand-status')].map((el) =>
          el.getBoundingClientRect(),
        );
        const labels = [...document.querySelectorAll('.player-hand .hand-label')].map((el) =>
          el.getBoundingClientRect(),
        );
        const cards = [...document.querySelectorAll('.player-hand .playing-card')].map((el) =>
          el.getBoundingClientRect(),
        );
        return {
          labelsAboveMessage: labels.every((r) => r.bottom + 8 <= message.top),
          resultsAboveMessage: results.every((r) => r.bottom + 8 <= message.top),
          cardsAboveMessage: cards.every((r) => r.bottom < message.top),
          messageAboveControls: message.bottom + 8 <= footer.top,
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
          headerFits: rect('.brand').right + 2 <= rect('.topbar nav').left,
        };
      });
      expect(layout, sample.name).toEqual({
        labelsAboveMessage: true,
        resultsAboveMessage: true,
        cardsAboveMessage: true,
        messageAboveControls: true,
        noHorizontalOverflow: true,
        headerFits: true,
      });
      if (sample.name === 'split')
        await expect(page.locator('.table-message')).toContainText('All square this round.');
      await page.close();
    }
  });
}

test('all interface values use clear numerals and invalid audio preferences do not crash the table', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('noir-club.audio', 'null'));
  await seed(page, ['10', '6', '9', '10', '5'], { balance: 14500, bet: 500 });
  for (const selector of [
    '.bankroll strong',
    '.bet-input input',
    '.chip span',
    '.brand span',
    '.table-title',
  ])
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain('DM Sans');
  await tracker(page);
  for (const selector of ['.dialog h2', '.tracker-hero strong'])
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain('DM Sans');
  expect(errors).toEqual([]);
});

test('settings save independent volumes, pace and motion without changing the game', async ({
  page,
}) => {
  await seed(page, ['8', '6', '8', '10', '3']);
  const before = await saved(page);
  await page.getByRole('button', { name: 'Open settings' }).click();
  const music = page.getByRole('slider', { name: 'Background music volume' });
  await music.press('Home');
  for (let i = 0; i < 4; i++) await music.press('ArrowRight');
  const effects = page.getByRole('slider', { name: 'Sound effects volume' });
  await effects.press('Home');
  await expect(page.getByRole('button', { name: 'Preview sound effect' })).toBeDisabled();
  await effects.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Preview sound effect' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Dealing speed', exact: true }).selectOption('relaxed');
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).check();
  await expect(page.locator('.app')).toHaveClass(/reduce-motion/);
  expect(await saved(page)).toEqual(before);
  const restored = await page.context().newPage();
  await restored.goto('./');
  await restored.getByRole('button', { name: 'Open settings' }).click();
  await expect(restored.getByRole('slider', { name: 'Background music volume' })).toHaveValue('20');
  await expect(restored.getByRole('slider', { name: 'Sound effects volume' })).toHaveValue('5');
  await expect(restored.getByRole('combobox', { name: 'Dealing speed', exact: true })).toHaveValue(
    'relaxed',
  );
  await expect(
    restored.getByRole('checkbox', { name: 'Reduce motion', exact: true }),
  ).toBeChecked();
  await restored.getByRole('button', { name: 'Close dialog' }).click();
  await restored.getByRole('button', { name: 'Deal me in' }).click();
  await expect(restored.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  expect(
    await restored
      .locator('.playing-card')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration)),
  ).toBeLessThanOrEqual(0.001);
  await restored.close();
});

test.describe('desktop keyboard controls', () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false });
  test('all six custom shortcuts work, conflicts are rejected and mappings persist', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await seed(page, ['8', '6', '8', '10', '3', '2', '4', '9', '5', '10', '6', '6', '10']);
    await expect(page.locator('.deal-button kbd')).toHaveText('Space');
    await expect(page.locator('.deal-button kbd')).toBeVisible();
    await page.getByRole('button', { name: 'Open settings' }).click();
    const hitKey = page.getByRole('button', { name: 'Change hit shortcut', exact: true });
    await hitKey.click();
    await hitKey.press('s');
    await expect(page.getByRole('status').filter({ hasText: 'already assigned' })).toContainText(
      'Stand',
    );
    await hitKey.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    for (const [label, key] of [
      ['hit', 'x'],
      ['stand', 'w'],
      ['double', 'c'],
      ['split', 'v'],
      ['surrender', 'z'],
      ['deal cards', '1'],
    ]) {
      const button = page.getByRole('button', { name: `Change ${label} shortcut`, exact: true });
      await button.click();
      await button.press(key);
      await expect(button).toHaveText(key.toUpperCase());
    }
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.locator('.deal-button kbd')).toHaveText('1');
    await page.getByRole('main').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeEnabled();
    await page.keyboard.press('v');
    await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
    expect((await saved(page)).hands).toHaveLength(2);
    await page.keyboard.press('x');
    await expect(page.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
    expect((await saved(page)).hands[0].cards).toHaveLength(3);
    await page.keyboard.press('w');
    await expect(page.getByRole('button', { name: 'Double', exact: true })).toBeEnabled();
    await page.keyboard.press('c');
    await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
    expect((await saved(page)).hands[1].bet).toBe(100);
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: 'Surrender', exact: true })).toBeEnabled();
    await page.keyboard.press('z');
    await expect(page.locator('.hand-result')).toHaveText('SURRENDER');
    const restored = await page.context().newPage();
    await restored.goto('./');
    await expect(restored.locator('.deal-button kbd')).toHaveText('1');
    await restored.getByRole('button', { name: 'Open settings' }).click();
    await restored
      .getByRole('checkbox', { name: 'Enable keyboard shortcuts', exact: true })
      .uncheck();
    await restored.getByRole('button', { name: 'Close dialog' }).click();
    await expect(restored.locator('.deal-button kbd')).toBeHidden();
    await restored.getByRole('main').click({ position: { x: 10, y: 10 } });
    await restored.keyboard.press('1');
    await expect(restored.locator('.app')).toHaveAttribute('data-phase', 'betting');
    await restored.close();
  });
});

test('mobile hides shortcuts while settings and stats retain their own scrolling', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  // New contexts do not inherit the configured baseURL.
  await page.goto(process.env.SITE_URL || 'http://localhost:5173');
  await expect(page.locator('.deal-button kbd')).toBeHidden();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByText('Keyboard shortcuts', { exact: true })).toBeHidden();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await page.locator('.settings-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.settings-footer')).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await tracker(page);
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Reset session' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Reset session' })).toBeInViewport();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.deal-button kbd')).toBeHidden();
  await assertViewport(page);
  await context.close();
});

for (const [speed, factor] of [
  ['slow', 2],
  ['quick', 0.7],
  ['relaxed', 1.5],
  ['normal', 1],
  ['fast', 0.5],
] as const) {
  test(`${speed} dealing synchronizes animation and split ace pacing`, async ({ page }) => {
    test.setTimeout(30000);
    await page.addInitScript(
      ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
      { key: SETTINGS_KEY, settings: { ...DEFAULT_SETTINGS, speed } },
    );
    await seed(page, ['A', '6', 'A', '10', '10', '9', '5']);
    await page.getByRole('button', { name: 'Deal me in' }).click();
    expect(
      await page
        .locator('.arriving')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration)),
    ).toBeCloseTo(0.48 * factor, 2);
    await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeEnabled();
    await monitorCards(page, Math.max(3000, factor * 4500));
    await page.evaluate(() => {
      (window as any).__splitMotion = [[], []];
      (window as any).__splitSampler = setInterval(() => {
        document.querySelectorAll('.player-hand').forEach((hand, seat) => {
          const card = hand.querySelector('.split-arrival');
          if (!card) return;
          const css = getComputedStyle(card);
          const matrix = css.transform === 'none' ? new DOMMatrix() : new DOMMatrix(css.transform);
          (window as any).__splitMotion[seat].push({
            time: performance.now(),
            y: matrix.m42,
            duration: parseFloat(css.animationDuration),
            opacity: Number(css.opacity),
            name: css.animationName,
          });
        });
      }, 16);
    });
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled', { timeout: 12000 });
    await assertMotion(page);
    const travel = await page.evaluate(() => {
      clearInterval((window as any).__splitSampler);
      return (window as any).__splitMotion;
    });
    for (const samples of travel) {
      expect(samples.length).toBeGreaterThan(5);
      expect(Math.min(...samples.map((s: any) => s.y))).toBeLessThan(-12);
      expect(samples.at(-1).y).toBeCloseTo(0, 2);
      expect(samples.every((s: any) => s.opacity === 1 && s.name === 'split-deal-card')).toBe(true);
      expect(samples[0].duration).toBeCloseTo(0.72 * factor, 2);
    }
    // The first card lands fully before the second hand receives its card.
    const firstLanding = travel[0].find((s: any) => Math.abs(s.y) < 0.2)!;
    expect(travel[1][0].time - firstLanding.time).toBeGreaterThan(70 * factor);
    expect((await saved(page)).stats.hands).toBe(2);
    await expect(page.locator('.dealer-hand .card-back')).toHaveCount(0);
    await assertViewport(page);
  });
}

test('sound preview emits an audible signal, resumes audio, and respects mute', async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, settings }) => {
      localStorage.setItem(key, JSON.stringify(settings));
      const Original = window.AudioContext;
      (window as any).__audioContexts = [];
      (window as any).__effectPeak = 0;
      if (Original)
        window.AudioContext = class extends Original {
          constructor() {
            super();
            (window as any).__audioContexts.push(this);
          }
          private outputs = 0;
          createGain() {
            const gain = super.createGain();
            const connect = gain.connect.bind(gain);
            gain.connect = ((destination: AudioNode) => {
              if (destination === this.destination && ++this.outputs === 2) {
                const analyser = this.createAnalyser();
                analyser.fftSize = 2048;
                connect(analyser);
                const samples = new Float32Array(analyser.fftSize);
                setInterval(() => {
                  analyser.getFloatTimeDomainData(samples);
                  for (const sample of samples)
                    (window as any).__effectPeak = Math.max(
                      (window as any).__effectPeak,
                      Math.abs(sample),
                    );
                }, 10);
              }
              return connect(destination);
            }) as typeof gain.connect;
            return gain;
          }
        };
    },
    { key: SETTINGS_KEY, settings: { ...DEFAULT_SETTINGS, music: false } },
  );
  await page.goto('./');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const preview = page.getByRole('button', { name: 'Preview sound effect' });
  await preview.click();
  if (await page.evaluate(() => typeof AudioContext !== 'undefined')) {
    await expect(page.locator('.sound-preview-status')).toContainText('Playing: card deal');
    await expect(preview).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => (window as any).__effectPeak))
      .toBeGreaterThan(0.01);
    await expect(page.locator('.sound-preview-status')).toContainText('Preview finished');
    await page.evaluate(async () => {
      await (window as any).__audioContexts[0].suspend();
      (window as any).__effectPeak = 0;
    });
    await preview.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__audioContexts[0].state))
      .toBe('running');
    await expect
      .poll(() => page.evaluate(() => (window as any).__effectPeak))
      .toBeGreaterThan(0.01);
    await expect(preview).toBeEnabled();
    await page.evaluate(() => (window as any).__audioContexts[0].close());
    await preview.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__audioContexts[1]?.state))
      .toBe('running');
  } else {
    await expect(page.locator('.sound-preview-status')).toContainText('Audio could not start');
  }
  await page.getByRole('checkbox', { name: 'Sound effects', exact: true }).uncheck();
  await expect(preview).toBeDisabled();
  await expect(page.locator('.sound-preview-status')).toContainText('Turn on sound effects');
  await page.getByRole('checkbox', { name: 'Sound effects', exact: true }).check();
  await expect(preview).toBeEnabled();
  if (await page.evaluate(() => typeof AudioContext !== 'undefined')) {
    await page.evaluate(() => {
      (window as any).__effectPeak = 0;
    });
    await preview.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__effectPeak))
      .toBeGreaterThan(0.01);
    await expect(preview).toBeEnabled();
  }
  await page.getByRole('slider', { name: 'Sound effects volume' }).press('Home');
  await expect(preview).toBeDisabled();
  await expect(page.locator('.sound-preview-status')).toContainText('raise the volume');
});

test('coaching defaults off, can be enabled independently, and preferences survive reopening', async ({
  page,
}) => {
  await seed(page, ['10', '6', '2', '10', '9', 'K']);
  await expect(page.getByRole('button', { name: 'Show strategy hint' })).toHaveCount(0);
  await expect(page.locator('.decision-feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings' }).click();
  const live = page.getByRole('checkbox', { name: 'Live decision feedback', exact: true });
  const hints = page.getByRole('checkbox', { name: 'Strategy hints', exact: true });
  await expect(live).not.toBeChecked();
  await expect(hints).not.toBeChecked();
  await hints.check();
  await expect(live).not.toBeChecked();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Show strategy hint' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show strategy hint' })).toBeDisabled();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await page.getByRole('button', { name: 'Hit', exact: true }).click();
  await expect(page.locator('.decision-feedback')).toHaveCount(0);
  const restored = await page.context().newPage();
  await restored.goto('./');
  await restored.bringToFront();
  await restored.getByRole('button', { name: 'Open settings' }).click();
  await expect(
    restored.getByRole('checkbox', { name: 'Strategy hints', exact: true }),
  ).toBeChecked();
  await expect(
    restored.getByRole('checkbox', { name: 'Live decision feedback', exact: true }),
  ).not.toBeChecked();
  await restored.getByRole('checkbox', { name: 'Strategy hints', exact: true }).uncheck();
  await restored.getByRole('checkbox', { name: 'Live decision feedback', exact: true }).check();
  await restored.getByRole('button', { name: 'Close dialog' }).click();
  await expect(restored.getByRole('button', { name: 'Show strategy hint' })).toHaveCount(0);
  await expect(restored.locator('.decision-feedback')).toHaveCount(0); // Enabling never reveals an earlier choice.
  await restored.close();
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [568, 320],
  [1366, 768],
]) {
  test(`optional hint and feedback fit ${width}x${height} without changing the game`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
      {
        key: SETTINGS_KEY,
        settings: { ...DEFAULT_SETTINGS, strategyHints: true, liveFeedback: true },
      },
    );
    await seed(page, ['10', '6', '2', '10', '2', 'K']);
    await page.getByRole('button', { name: 'Deal me in' }).click();
    await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
    const initial = await saved(page);
    await assertViewport(page);
    await page.getByRole('button', { name: 'Show strategy hint' }).click();
    await expect(page.locator('.coach-answer h3')).toHaveText('Stand');
    await expect(page.getByRole('dialog')).toContainText('10♠ 2♠ (12) vs 6♠');
    expect(await saved(page)).toEqual(initial);
    await page.getByRole('button', { name: 'Back to my hand' }).click();
    await monitorCards(page, 1600);
    await page.getByRole('button', { name: 'Hit', exact: true }).click();
    await expect(page.locator('.decision-feedback')).toContainText('Hit · Better: Stand');
    await assertMotion(page);
    await assertViewport(page);
    await page.getByRole('button', { name: 'Explain my last choice' }).click();
    await expect(page.getByRole('dialog')).toContainText('(12) vs 6♠ · before your choice');
    await expect(page.getByRole('dialog')).not.toContainText('(14) vs');
    await expect(page.locator('.coach-answer')).toContainText('Recommended: Stand');
    await page.getByRole('button', { name: 'Back to the table' }).click();
    await page.getByRole('button', { name: 'Stand', exact: true }).click();
    await expect(page.locator('.decision-feedback')).toContainText('Stand · Correct');
    await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
    await assertViewport(page);
    expect((await saved(page)).stats).toMatchObject({
      strategyDecisions: 2,
      strategyCorrectDecisions: 1,
    });
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('checkbox', { name: 'Live decision feedback', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Strategy hints', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.locator('.decision-feedback')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show strategy hint' })).toHaveCount(0);
  });
}

test('coaching handles insurance, unavailable actions, and split-hand advice', async ({ page }) => {
  await page.addInitScript(
    ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
    {
      key: SETTINGS_KEY,
      settings: { ...DEFAULT_SETTINGS, strategyHints: true, liveFeedback: true },
    },
  );
  await seed(page, ['8', 'A', '8', '6', '3', '9', '10']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'insurance');
  await page.getByRole('button', { name: 'Show strategy hint' }).click();
  await expect(page.locator('.coach-answer h3')).toHaveText('Decline insurance');
  await page.getByRole('button', { name: 'Back to my hand' }).click();
  await page.getByRole('button', { name: 'No insurance', exact: true }).click();
  await expect(page.locator('.decision-feedback')).toContainText('No insurance · Correct');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.decision-feedback')).toContainText('Split · Correct');
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Show strategy hint' }).click();
  await expect(page.getByRole('dialog')).toContainText('Hand 1');
  await expect(page.locator('.coach-answer h3')).toHaveText('Hit');
  await page.getByRole('button', { name: 'Back to my hand' }).click();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.decision-feedback')).toContainText('Stand · Better: Hit');
  await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Show strategy hint' }).click();
  await expect(page.getByRole('dialog')).toContainText('Hand 2');
  await expect(page.locator('.coach-answer h3')).toHaveText('Stand');
  await page.getByRole('button', { name: 'Back to my hand' }).click();
});

test('sound preview reports unavailable audio inside the settings dialog', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class {
        constructor() {
          throw new Error('Audio unavailable');
        }
      },
    });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Preview sound effect' }).click();
  await expect(page.locator('.sound-preview-status')).toContainText('Audio could not start');
  await expect(page.getByRole('button', { name: 'Preview sound effect' })).toBeEnabled();
  const speed = page.getByRole('combobox', { name: 'Dealing speed', exact: true });
  await expect(speed.locator('option')).toHaveText(['Slow', 'Relaxed', 'Normal', 'Quick', 'Fast']);
  await speed.selectOption('fast');
  const restored = await page.context().newPage();
  await restored.goto('./');
  await restored.getByRole('button', { name: 'Open settings' }).click();
  await expect(restored.getByRole('combobox', { name: 'Dealing speed', exact: true })).toHaveValue(
    'fast',
  );
  await restored.close();
});

for (const [width, height] of [
  [320, 568],
  [568, 320],
  [768, 1024],
  [1366, 768],
]) {
  test(`re-splits to four hands with coaching and safe card motion at ${width}x${height}`, async ({
    page,
  }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
      {
        key: SETTINGS_KEY,
        settings: { ...DEFAULT_SETTINGS, strategyHints: true, liveFeedback: true, speed: 'fast' },
      },
    );
    await seed(page, ['3', '6', '3', '10', '3', '3', '3', '7', '9', '10', '10', '5']);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Deal me in' }).click();
    await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeEnabled();
    for (let hands = 2; hands <= 4; hands++) {
      await monitorCards(page, 1600, true);
      await page.getByRole('button', { name: 'Split', exact: true }).click();
      await expect(page.locator('.player-hand')).toHaveCount(hands);
      await expect(page.getByRole('button', { name: 'Hit', exact: true })).toBeEnabled();
      await expect(page.locator('.decision-feedback')).toContainText('Split · Correct');
      expect((await saved(page)).balance).toBe(2500 - hands * 50);
      await assertMotion(page);
      await assertViewport(page);
      await assertHandClearance(page);
      const cards = page.locator('.player-hand').first().locator('.card-position');
      const first = (await cards.nth(0).boundingBox())!;
      const second = (await cards.nth(1).boundingBox())!;
      expect(second.x - first.x).toBeGreaterThan(10); // Both ranks must remain readable.
    }
    await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Show strategy hint' }).click();
    await expect(page.locator('.coach-answer h3')).toHaveText('Hit');
    await page.getByRole('button', { name: 'Back to my hand' }).click();
    // Open the saved unfinished four-hand table without running the original page's seed again.
    await page.getByRole('button', { name: 'Open settings' }).click();
    const resumed = await page.context().newPage();
    await resumed.setViewportSize({ width, height });
    await resumed.goto('./');
    await resumed.bringToFront();
    await expect(resumed.locator('.player-hand')).toHaveCount(4);
    expect((await saved(resumed)).balance).toBe(2300);
    await monitorCards(resumed, 6500, true);
    await resumed.getByRole('button', { name: 'Hit', exact: true }).click();
    expect(
      await resumed
        .locator('.player-hand')
        .first()
        .locator('.playing-card')
        .last()
        .evaluate((el) => ({
          name: getComputedStyle(el).animationName,
          duration: parseFloat(getComputedStyle(el).animationDuration),
        })),
    ).toEqual({ name: height <= 380 ? 'compact-deal-card' : 'deal-card', duration: 0.24 });
    for (let hand = 0; hand < 4; hand++) {
      await expect(resumed.getByRole('button', { name: 'Stand', exact: true })).toBeEnabled();
      expect((await saved(resumed)).active).toBe(hand);
      await resumed.getByRole('button', { name: 'Stand', exact: true }).click();
    }
    await expect(resumed.locator('.app')).toHaveAttribute('data-phase', 'settled');
    await assertMotion(resumed);
    await assertViewport(resumed);
    await assertHandClearance(resumed);
    const finished = await saved(resumed);
    expect(finished.stats).toMatchObject({
      hands: 4,
      wagered: 200,
      strategyDecisions: 8,
      strategyCorrectDecisions: 8,
      strategyCorrectHands: 4,
    });
    await tracker(resumed);
    await expect(resumed.getByRole('dialog')).toContainText('100%');
    await resumed.close();
  });
}

function bankruptSession() {
  const shoe: Card[] = Array(7)
    .fill(['10', '10', '8', '9'])
    .flat()
    .map((rank, i) => ({ rank, id: `bankrupt-${i}`, suit: 'clubs' }));
  let game = reducer(newGame([...shoe, ...makeShoe()]), { type: 'BET', amount: 500 });
  for (let i = 0; i < 5; i++) {
    game = reducer(game, { type: 'DEAL' });
    for (let j = 0; j < 10 && game.phase !== 'settled'; j++)
      game = reducer(game, {
        type: game.phase === 'player' ? 'STAND' : game.phase === 'dealer' ? 'DEALER_TICK' : 'READY',
      });
  }
  expect(game.balance).toBe(0);
  // A newly opened table clears the settled cards but retains the session.
  return { ...game, phase: 'betting' as const, dealer: [], hands: [], accuracy: null };
}

test('bankruptcy continuation keeps accuracy and losses through the next hand and reload', async ({
  page,
}) => {
  const broke = bankruptSession();
  await seed(page, [], broke);
  await assertViewport(page);
  await page.getByRole('button', { name: 'Continue playing', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your net result stays at −2,500');
  await page.getByRole('button', { name: 'Add 2,500 · keep stats', exact: true }).click();
  expect((await saved(page)).stats).toEqual({ ...broke.stats, refills: 1 });
  expect((await saved(page)).history).toEqual(broke.history);
  await page.getByRole('button', { name: 'Deal me in', exact: true }).click();
  await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  expect(await saved(page)).toMatchObject({
    balance: 2000,
    stats: {
      net: -3000,
      refills: 1,
      hands: 6,
      strategyCorrectHands: 6,
      strategyHands: 6,
    },
  });
  await expect(page.locator('.table-message')).not.toContainText(/accuracy|correct|mistake/i);
  await assertViewport(page);
  await tracker(page);
  await expect(page.locator('.tracker-hero')).toContainText('−3,000');
  await expect(
    page
      .getByRole('dialog')
      .getByRole('img', { name: 'Net result trend, cumulative result −3,000 credits' }),
  ).toBeVisible();
  await expect(
    page.locator('.tracker-grid > div').filter({ hasText: 'Bankroll refills' }),
  ).toHaveText('Bankroll refills1');
  await expect(
    page.locator('.tracker-grid > div').filter({ hasText: 'Credits added after bankruptcy' }),
  ).toHaveText('Credits added after bankruptcy2,500');
  const restored = await page.context().newPage();
  await restored.goto('./');
  expect((await saved(restored)).stats).toEqual((await saved(page)).stats);
  expect((await saved(restored)).history).toEqual((await saved(page)).history);
  await restored.close();
});

test('bankruptcy can still reset deliberately, with a cancellable confirmation', async ({
  page,
}) => {
  const broke = bankruptSession();
  await seed(page, [], broke);
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toContainText('Keep your story going');
  await page.getByRole('button', { name: 'Reset stats instead' }).click();
  await expect(page.getByRole('dialog')).toContainText('This clears your saved history and stats');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect((await saved(page)).stats).toEqual(broke.stats);
  await page.getByRole('button', { name: 'Continue playing', exact: true }).click();
  await page.getByRole('button', { name: 'Reset stats instead' }).click();
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  expect(await saved(page)).toMatchObject({
    balance: 2500,
    stats: { refills: 0, net: 0, hands: 0 },
    history: [],
  });
  await assertViewport(page);
});
