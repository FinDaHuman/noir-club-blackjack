import { expect, test, type Page } from '@playwright/test';
import { newGame, makeShoe, type Card, type Game } from '../src/game';
const key = 'noir-club.game.v1';
async function seed(page: Page, ranks: string[], patch: Partial<Game> = {}) {
  const shoe: Card[] = ranks.map((rank, i) => ({ id: `seed-${i}`, rank, suit: 'spades' }));
  const game = { ...newGame([...shoe, ...makeShoe()]), ...patch };
  await page.addInitScript(({ key, game }) => localStorage.setItem(key, JSON.stringify(game)), {
    key,
    game,
  });
  await page.goto('/');
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
async function monitorCards(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
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
    }, 2400);
  });
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
  await restored.goto('/');
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
  await page.getByRole('button', { name: 'Mute background music' }).click();
  await expect(page.getByRole('button', { name: 'Enable background music' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Mute sound effects' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noir-club.audio')!))).toEqual({
    effects: false,
    music: false,
  });
  await page.getByRole('button', { name: 'Enable background music' }).click();
  await expect(page.getByRole('button', { name: 'Enable sound effects' })).toBeVisible();
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
  await restored.goto('/');
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
  [320, 667],
  [375, 812],
  [390, 844],
  [768, 1024],
  [844, 390],
  [1024, 768],
  [1536, 1024],
]) {
  test(`responsive ${width}x${height}: controls, assets and card clearance`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seed(page, ['8', '10', '8', '7', '2', '3']);
    await expect(page.getByRole('button', { name: 'Deal me in' })).toBeVisible();
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
    await monitorCards(page);
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await assertMotion(page);
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
  await reopened.goto('/');
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
  await reopened.goto('/');
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
