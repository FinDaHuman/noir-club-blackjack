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
async function monitorCards(page: Page, duration = 2400) {
  await page.bringToFront();
  await page.evaluate((duration) => {
    (window as any).__cardMonitor = null;
    const failures: string[] = [];
    let samples = 0;
    let frames = 0;
    const measure = () => {
      samples++;
      const footer = document.querySelector('.control-deck')!.getBoundingClientRect();
      document.querySelectorAll<HTMLElement>('.playing-card, .card-flipper').forEach((card) => {
        const r = card.getBoundingClientRect();
        if (r.left < -1 || r.right > innerWidth + 1 || r.bottom > footer.top + 1)
          failures.push(
            `Card outside safe table at sample ${samples}: ${JSON.stringify(r.toJSON())}`,
          );
        let parent = card.parentElement;
        while (parent && parent !== document.body) {
          const css = getComputedStyle(parent);
          if (
            ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowY) &&
            parent.getBoundingClientRect().bottom < r.bottom - 1
          )
            failures.push(`Clipped by ${parent.className}`);
          parent = parent.parentElement;
        }
      });
    };
    let raf = 0;
    const tick = () => {
      frames++;
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Headless WebKit may throttle compositor callbacks on a shared Linux runner.
    // Force fresh layout reads every 16ms as well; preserve all geometry assertions.
    const timer = setInterval(measure, 16);
    setTimeout(() => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      measure();
      (window as any).__cardMonitor = { failures, frames, samples };
    }, duration);
  }, duration);
}
async function assertMotion(page: Page) {
  await expect
    .poll(() => page.evaluate(() => (window as any).__cardMonitor?.samples ?? 0))
    .toBeGreaterThan(30);
  expect(await page.evaluate(() => (window as any).__cardMonitor.failures)).toEqual([]);
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
      await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
      await expect(page.locator('.hand-result')).toHaveText(sample.labels);
      await assertViewport(page);
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
  ['quick', 0.7],
  ['relaxed', 1.5],
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
    await monitorCards(page, 6500);
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled', { timeout: 12000 });
    await assertMotion(page);
    expect((await saved(page)).stats.hands).toBe(2);
    await expect(page.locator('.dealer-hand .card-back')).toHaveCount(0);
    await assertViewport(page);
  });
}
