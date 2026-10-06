import { expect, test, type Page } from '@playwright/test';
import { makeShoe, newGame, SAVE_KEY, type Card, type Game } from '../src/game';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/settings';

test.setTimeout(60000);

async function seed(page: Page, ranks: string[], balance = 50) {
  const cards = ranks.map((rank, i): Card => ({ rank, id: `debt-${i}`, suit: 'spades' }));
  const game = { ...newGame([...cards, ...makeShoe()]), balance };
  await page.addInitScript(
    ({ game, saveKey, settingsKey, settings }) => {
      // Seed only once so reloads exercise the actual saved game.
      if (!localStorage.getItem(saveKey)) localStorage.setItem(saveKey, JSON.stringify(game));
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    },
    {
      game,
      saveKey: SAVE_KEY,
      settingsKey: SETTINGS_KEY,
      settings: {
        ...DEFAULT_SETTINGS,
        speed: 'fast',
        reducedMotion: true,
        music: false,
        effects: false,
      },
    },
  );
  await page.goto('./');
  await expect(page).toHaveTitle(/Noir Club.*Blackjack/i);
  await expect(page.getByRole('main', { name: 'Blackjack table' })).toBeVisible();
}

async function saved(page: Page): Promise<Game> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}

async function play(page: Page, action: 'Split' | 'Double' | 'Stand') {
  const button = page.getByRole('button', { name: action, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

async function assertDialogFits(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.right <= innerWidth + 1 &&
        rect.top >= 0 &&
        rect.bottom <= innerHeight + 1
      );
    }),
  ).toBe(true);
}

test('debt consent is cancellable for both mouse and keyboard actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await seed(page, ['8', '10', '8', '9', '10'], 75);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'player');
  const before = await saved(page);
  await play(page, 'Split');
  await expect(page.getByRole('dialog')).toContainText('Split with debt?');
  await expect(page.getByRole('dialog')).toContainText('it will become -25 credits');
  await assertDialogFits(page);
  if (process.env.DEBT_QA_DIR)
    await page.screenshot({
      path: `${process.env.DEBT_QA_DIR}/debt-consent-${test.info().project.name}.png`,
    });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await page.keyboard.press('d');
  await expect(page.getByRole('dialog')).toContainText('Double with debt?');
  await page.keyboard.press('Escape');
  expect(await saved(page)).toEqual(before);
  await play(page, 'Stand');
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  expect((await saved(page)).continueDebt).toBe(false);
  expect(errors).toEqual([]);
});

test('one consent covers split-hand doubles, re-splits, later rounds, reload and Stats reset', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await seed(page, [
    '8',
    '6',
    '8',
    '10',
    '3',
    '2',
    '10',
    '5',
    '8',
    '10',
    '8',
    '9',
    '8',
    '2',
    '2',
    '10',
    '10',
  ]);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await play(page, 'Split');
  await page.getByRole('button', { name: 'Split with debt', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await play(page, 'Double');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).active).toBe(1);
  await play(page, 'Stand');
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await saved(page)).toMatchObject({
    balance: -100,
    continueDebt: true,
    stats: { net: -150, hands: 2 },
  });
  await page.reload();
  await expect(page.locator('.bankroll strong')).toHaveText('-100');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const bet = page.getByRole('spinbutton', { name: 'Bet amount' });
  await bet.fill('100');
  await bet.press('Tab');
  expect((await saved(page)).bet).toBe(100);
  await bet.fill('50');
  await bet.press('Tab');
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await play(page, 'Split');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await play(page, 'Split');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await play(page, 'Double');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await play(page, 'Stand');
  await play(page, 'Stand');
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const debt = await saved(page);
  expect(debt).toMatchObject({
    balance: -300,
    continueDebt: true,
    stats: { rounds: 2, hands: 5, refills: 0 },
  });
  expect(debt.balance).toBe(50 + debt.stats.net);
  if (process.env.DEBT_QA_DIR)
    await page.screenshot({
      path: `${process.env.DEBT_QA_DIR}/debt-settled-${test.info().project.name}.png`,
    });
  const mobile = page.getByRole('button', { name: 'Open player tracker' });
  if (await mobile.isVisible()) await mobile.click();
  else await page.getByRole('button', { name: 'View tracker' }).click();
  await page.getByRole('button', { name: 'Reset session' }).click();
  await page.getByRole('button', { name: 'Keep my session' }).click();
  expect((await saved(page)).balance).toBe(-300);
  await page.getByRole('button', { name: 'Reset session' }).click();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  expect(await saved(page)).toMatchObject({
    balance: 2500,
    continueDebt: false,
    stats: { net: 0, hands: 0 },
    history: [],
  });
  expect(errors).toEqual([]);
});

test('debt consent resets after a positive bankroll and is requested again on the next shortfall', async ({
  page,
}) => {
  await seed(page, ['5', '6', '6', '10', '10', '10', '5', '9', '6', '8', '10']);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await play(page, 'Double');
  await page.getByRole('button', { name: 'Double with debt', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  expect(await saved(page)).toMatchObject({ balance: 150, continueDebt: false });
  const bet = page.getByRole('spinbutton', { name: 'Bet amount' });
  await bet.fill('100');
  await bet.press('Tab');
  await page.getByRole('button', { name: 'Deal again' }).click();
  await play(page, 'Double');
  await expect(page.getByRole('dialog')).toContainText('Double with debt?');
  expect(await saved(page)).toMatchObject({ balance: 50, continueDebt: false });
});

test('the first debt prompt can start when doubling an already split hand', async ({ page }) => {
  await seed(page, ['8', '6', '8', '10', '3', '2', '10', '5'], 100);
  await page.getByRole('button', { name: 'Deal me in' }).click();
  await play(page, 'Split');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await play(page, 'Double');
  await expect(page.getByRole('dialog')).toContainText('Double with debt?');
  const before = await saved(page);
  expect(before).toMatchObject({ balance: 0, continueDebt: false });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await play(page, 'Double');
  await page.getByRole('button', { name: 'Double with debt', exact: true }).click();
  await play(page, 'Stand');
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'settled');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await saved(page)).toMatchObject({ balance: -50, continueDebt: true });
});
