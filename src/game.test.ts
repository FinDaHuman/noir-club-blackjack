import { describe, expect, it, vi } from 'vitest';
import {
  canDouble,
  canRefill,
  canSplit,
  canSurrender,
  loadGame,
  makeShoe,
  natural,
  newGame,
  reducer,
  score,
  type Card,
  type Game,
} from './game';
let id = 0;
const card = (rank: string): Card => ({ id: `test-${id++}`, rank, suit: 'spades' });
const cards = (...ranks: string[]) => ranks.map(card);
function deal(...ranks: string[]) {
  return reducer(newGame([...cards(...ranks), ...makeShoe()]), { type: 'DEAL' });
}
function ready(...ranks: string[]) {
  let g = reducer(deal(...ranks), { type: 'READY' });
  if (g.phase === 'insurance') g = reducer(g, { type: 'DECLINE_INSURANCE' });
  if (g.phase === 'peeking') g = reducer(g, { type: 'READY' });
  return g;
}
function finish(state: Game) {
  let g = state;
  for (let i = 0; i < 100 && g.phase !== 'settled'; i++)
    g = reducer(g, {
      type:
        g.phase === 'insurance'
          ? 'DECLINE_INSURANCE'
          : g.phase === 'player'
            ? 'STAND'
            : g.phase === 'dealer'
              ? 'DEALER_TICK'
              : 'READY',
    });
  expect(g.phase).toBe('settled');
  return g;
}

describe('blackjack scoring and payouts', () => {
  it('downgrades aces without losing soft totals', () => {
    expect(score(cards('A', '6'))).toEqual({ total: 17, soft: true });
    expect(score(cards('A', 'A', '9'))).toEqual({ total: 21, soft: true });
    expect(score(cards('A', 'K', '5'))).toEqual({ total: 16, soft: false });
  });
  it('only recognizes two-card naturals', () => {
    expect(natural(cards('A', 'K'))).toBe(true);
    expect(natural(cards('7', '7', '7'))).toBe(false);
  });
  it('deals in alternating order and deducts exactly one bet', () => {
    const g = deal('10', '6', '9', '8');
    expect(g.hands[0].cards.map((c) => c.rank)).toEqual(['10', '9']);
    expect(g.dealer.map((c) => c.rank)).toEqual(['6', '8']);
    expect(g.balance).toBe(2450);
    expect(g.phase).toBe('dealing');
  });
  it('pays a natural at 3:2 and accounts for half credits', () => {
    let g = newGame([...cards('A', '9', 'K', '7'), ...makeShoe()]);
    g = reducer(g, { type: 'BET', amount: 25 });
    g = reducer(reducer(g, { type: 'DEAL' }), { type: 'READY' });
    expect(g.balance).toBe(2537.5);
    expect(g.stats.blackjacks).toBe(1);
    expect(g.stats.net).toBe(37.5);
  });
  it('pushes equal naturals', () => {
    const g = ready('A', 'K', 'Q', 'A');
    expect(g.balance).toBe(2500);
    expect(g.hands[0].result).toBe('push');
  });
  it('dealer blackjack ends the round before player actions', () => {
    const g = ready('10', 'A', '9', 'K');
    expect(g.phase).toBe('settled');
    expect(g.balance).toBe(2450);
    expect(reducer(g, { type: 'HIT' })).toBe(g);
  });
  it('stands on soft 17', () => {
    const g = finish(ready('10', 'A', '8', '6'));
    expect(g.dealer).toHaveLength(2);
    expect(g.balance).toBe(2550);
  });
  it('draws to 17 and returns the stake on a push', () => {
    const g = finish(ready('10', '9', '8', '7', '2'));
    expect(g.dealer).toHaveLength(3);
    expect(g.hands[0].result).toBe('push');
    expect(g.balance).toBe(2500);
  });
  it('a bust loses even if the dealer could bust', () => {
    const g = finish(reducer(ready('10', '10', '8', '6', '9'), { type: 'HIT' }));
    expect(g.balance).toBe(2450);
    expect(g.dealer).toHaveLength(2);
  });
  it('dealer bust pays a normal win', () => {
    const g = finish(ready('10', '10', '8', '6', 'K'));
    expect(g.balance).toBe(2550);
    expect(g.stats.wins).toBe(1);
  });
});
describe('actions, split rules and accounting', () => {
  it('locks duplicate deal and hit during motion', () => {
    const g = deal('5', '10', '6', '7');
    expect(reducer(g, { type: 'DEAL' })).toBe(g);
    const hit = reducer(ready('5', '10', '6', '7'), { type: 'HIT' });
    expect(hit.phase).toBe('hitting');
    expect(reducer(hit, { type: 'HIT' })).toBe(hit);
  });
  it('double deducts an extra wager and draws exactly one card', () => {
    const g = finish(reducer(ready('5', '10', '6', '7', '10'), { type: 'DOUBLE' }));
    expect(g.hands[0].cards).toHaveLength(3);
    expect(g.hands[0].bet).toBe(100);
    expect(g.balance).toBe(2600);
  });
  it('requires funds for double and split', () => {
    const g = { ...ready('8', '10', '8', '7'), balance: 0 };
    expect(canDouble(g)).toBe(false);
    expect(canSplit(g)).toBe(false);
    expect(reducer(g, { type: 'SPLIT' })).toBe(g);
  });
  it('splits same-rank pairs only, once, and advances both hands', () => {
    expect(canSplit(ready('J', '9', 'K', '7'))).toBe(false);
    let g = reducer(ready('8', '10', '8', '7', '2', '3'), { type: 'SPLIT' });
    expect(g.balance).toBe(2400);
    expect(g.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([['8'], ['8']]);
    g = reducer(g, { type: 'READY' });
    expect(g.phase).toBe('split-dealing');
    expect(g.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([['8', '2'], ['8']]);
    expect(g.shoe[0].rank).toBe('3');
    for (const type of ['HIT', 'STAND', 'DOUBLE', 'SPLIT'] as const)
      expect(reducer(g, { type })).toBe(g);
    g = reducer(g, { type: 'READY' });
    expect(canSplit(g)).toBe(false);
    g = reducer(g, { type: 'STAND' });
    expect(g.active).toBe(1);
    expect(g.phase).toBe('split-dealing');
    expect(g.hands[1].cards.map((c) => c.rank)).toEqual(['8', '3']);
    g = reducer(g, { type: 'READY' });
    expect(g.phase).toBe('player');
    expect(finish(g).stats.hands).toBe(2);
  });
  it('allows double after split', () => {
    let g = reducer(ready('8', '10', '8', '7', '3', '2', 'K'), { type: 'SPLIT' });
    g = reducer(g, { type: 'READY' });
    g = reducer(g, { type: 'READY' });
    expect(canDouble(g)).toBe(true);
    g = reducer(g, { type: 'DOUBLE' });
    expect(g.hands[0].bet).toBe(100);
    expect(g.balance).toBe(2350);
  });
  it('split aces receive one card and split 21 pays only 1:1', () => {
    const g = finish(reducer(ready('A', '10', 'A', '7', 'K', 'Q'), { type: 'SPLIT' }));
    expect(g.hands.every((h) => h.cards.length === 2)).toBe(true);
    expect(g.balance).toBe(2600);
    expect(g.stats.blackjacks).toBe(0);
    expect(g.stats.wagered).toBe(100);
  });
  it('skips a split 21 and plays the other hand', () => {
    let g = reducer(ready('K', '10', 'K', '7', 'A', '2'), { type: 'SPLIT' });
    g = reducer(g, { type: 'READY' });
    g = reducer(g, { type: 'READY' });
    expect(g.active).toBe(1);
    expect(g.phase).toBe('split-dealing');
    g = reducer(g, { type: 'READY' });
    expect(g.phase).toBe('player');
  });
  it('draws for the first split hand before exposing or drawing the second hand card', () => {
    let g = reducer(ready('8', '6', '8', '10', '2', '3', '4', '5'), { type: 'SPLIT' });
    g = reducer(reducer(g, { type: 'READY' }), { type: 'READY' });
    g = reducer(reducer(g, { type: 'HIT' }), { type: 'READY' });
    expect(g.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([['8', '2', '3'], ['8']]);
    g = reducer(g, { type: 'STAND' });
    expect(g.hands[1].cards.map((c) => c.rank)).toEqual(['8', '4']);
  });
  it('gives each split ace a separate dealing phase before revealing the dealer', () => {
    let g = reducer(ready('A', '6', 'A', '10', 'K', '9', '5'), { type: 'SPLIT' });
    expect(g.hands.map((h) => h.cards.length)).toEqual([1, 1]);
    g = reducer(g, { type: 'READY' });
    expect(g).toMatchObject({ phase: 'split-dealing', active: 0 });
    expect(g.hands.map((h) => h.cards.length)).toEqual([2, 1]);
    g = reducer(g, { type: 'READY' });
    expect(g).toMatchObject({ phase: 'split-dealing', active: 1 });
    expect(g.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(g.history).toHaveLength(0);
    expect(reducer(g, { type: 'HIT' })).toBe(g);
    g = reducer(g, { type: 'READY' });
    expect(g.phase).toBe('dealer');
    expect(finish(g).stats.blackjacks).toBe(0);
  });
  it('resumes each split stage without losing pending cards or charging twice', () => {
    let g = reducer(ready('8', '6', '8', '10', '2', '3', '4', '5'), { type: 'SPLIT' });
    for (const type of ['READY', 'READY', 'HIT', 'READY', 'STAND', 'READY'] as const) {
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(g) });
      const restored = loadGame();
      expect(restored).toEqual(g);
      g = reducer(restored, { type });
      expect(g.balance).toBe(2400);
    }
    vi.unstubAllGlobals();
    expect(g.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([
      ['8', '2', '3'],
      ['8', '4'],
    ]);
    expect(finish(g).stats.wagered).toBe(100);
  });
  it('preserves already-dealt split hands from older saves', () => {
    for (const rank of ['8', 'A']) {
      const g = reducer(ready(rank, '6', rank, '10', '3', '4', '5'), { type: 'SPLIT' });
      // The previous release dealt both second cards as soon as Split was selected.
      g.hands.forEach((hand) => {
        hand.cards.push(g.shoe.shift()!);
        hand.stood = rank === 'A';
      });
      const remainingShoe = [...g.shoe];
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(g) });
      const restored = loadGame();
      expect(restored).toEqual(g);
      const next = reducer(restored, { type: 'READY' });
      expect(next.shoe).toEqual(remainingShoe);
      expect(next.balance).toBe(2400);
      expect(next.phase).toBe(rank === 'A' ? 'dealer' : 'player');
    }
    vi.unstubAllGlobals();
  });
  it('does not mutate previous game state', () => {
    const g = ready('8', '10', '7', '6', '3');
    const original = JSON.stringify(g);
    finish(reducer(g, { type: 'HIT' }));
    expect(JSON.stringify(g)).toBe(original);
  });
  it('limits bets and refuses reset in a live round', () => {
    let g = newGame();
    g = reducer(g, { type: 'BET', amount: 10000 });
    expect(g.bet).toBe(500);
    g = reducer(g, { type: 'BET', amount: 0 });
    expect(g.bet).toBe(10);
    expect(reducer(g, { type: 'BET', amount: NaN })).toBe(g);
    const live = ready('8', '9', '7', '6');
    expect(reducer(live, { type: 'RESET' })).toBe(live);
  });
  it('maintains bankroll = starting funds + net over 500 rounds', () => {
    let g = newGame();
    for (let i = 0; i < 500; i++) {
      if (g.balance < 10) g = reducer(g, { type: 'REFILL' });
      g = reducer(g, { type: 'BET', amount: 10 });
      g = finish(reducer(g, { type: 'DEAL' }));
      expect(g.balance).toBe(2500 * (1 + g.stats.refills) + g.stats.net);
      expect(g.stats.hands).toBe(g.stats.wins + g.stats.losses + g.stats.pushes);
      expect(g.balance).toBeGreaterThanOrEqual(0);
    }
    expect(g.history.length).toBeLessThanOrEqual(100);
  });
  it('creates a complete unique six-deck shoe', () => {
    const shoe = makeShoe();
    expect(shoe).toHaveLength(312);
    expect(new Set(shoe.map((c) => c.id)).size).toBe(312);
    expect(shoe.filter((c) => c.rank === 'A')).toHaveLength(24);
  });
  it('recovers from corrupt or unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{bad json' });
    expect(loadGame().balance).toBe(2500);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadGame().phase).toBe('betting');
    vi.unstubAllGlobals();
  });
});

describe('continuing after bankruptcy', () => {
  const bankrupt = () => {
    let g = newGame([...cards(...Array(6).fill(['10', '10', '8', '9']).flat()), ...makeShoe()]);
    g = reducer(g, { type: 'BET', amount: 500 });
    for (let i = 0; i < 5; i++) g = finish(reducer(g, { type: 'DEAL' }));
    expect(g.balance).toBe(0);
    return g;
  };
  it('keeps every statistic and history entry, then accumulates further losses', () => {
    const broke = bankrupt();
    const original = JSON.stringify(broke);
    const funded = reducer(broke, { type: 'REFILL' });
    expect(funded.stats).toEqual({ ...broke.stats, refills: 1 });
    expect(funded.history).toEqual(broke.history);
    expect(funded.shoe).toEqual(broke.shoe);
    expect(funded).toMatchObject({ balance: 2500, phase: 'betting', hands: [], dealer: [] });
    expect(JSON.stringify(broke)).toBe(original);
    expect(reducer(funded, { type: 'REFILL' })).toBe(funded);
    const next = finish(reducer(funded, { type: 'DEAL' }));
    expect(next.balance).toBe(2000);
    expect(next.stats).toMatchObject({
      net: -3000,
      hands: 6,
      losses: 6,
      refills: 1,
      strategyHands: 6,
      strategyCorrectHands: 6,
      strategyDecisions: 6,
      strategyCorrectDecisions: 6,
    });
    expect(next.history[0].id).toBe(6);
    expect(next.history.slice(1)).toEqual(broke.history);
  });
  it('preserves remaining fractional credits and supports repeated bankruptcies', () => {
    let g = bankrupt();
    g = { ...g, balance: 7.5, stats: { ...g.stats, net: -2492.5 } };
    g = reducer(g, { type: 'REFILL' });
    expect(g.balance).toBe(2507.5);
    expect(g.stats.net).toBe(-2492.5);
    g = { ...g, balance: 0, stats: { ...g.stats, net: -5000 } };
    g = reducer(g, { type: 'REFILL' });
    expect(g).toMatchObject({ balance: 2500, stats: { net: -5000, refills: 2 } });
  });
  it('rejects refills while a hand is live or a minimum bet is affordable', () => {
    for (const phase of [
      'dealing',
      'insurance',
      'peeking',
      'player',
      'hitting',
      'splitting',
      'split-dealing',
      'dealer',
    ] as const) {
      const g = { ...ready('10', '10', '8', '9'), balance: 0, phase };
      expect(canRefill(g)).toBe(false);
      expect(reducer(g, { type: 'REFILL' })).toBe(g);
    }
    const g = { ...newGame(), balance: 10 };
    expect(reducer(g, { type: 'REFILL' })).toBe(g);
  });
  it('restores refills and losses after reload, while a deliberate reset clears both', () => {
    const g = reducer(bankrupt(), { type: 'REFILL' });
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(g) });
    try {
      expect(loadGame()).toEqual(g);
      const reset = reducer(loadGame(), { type: 'RESET' });
      expect(reset).toMatchObject({ balance: 2500, stats: { net: 0, refills: 0 }, history: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('dealer peek, insurance and late surrender', () => {
  it.each(['10', 'J', 'Q', 'K'])('peeks on %s before any player action', (rank) => {
    const g = reducer(deal('9', rank, '7', '6'), { type: 'READY' });
    expect(g.phase).toBe('peeking');
    for (const type of ['HIT', 'SURRENDER', 'INSURE', 'DOUBLE', 'STAND'] as const)
      expect(reducer(g, { type })).toBe(g);
    expect(reducer(g, { type: 'READY' }).phase).toBe('player');
  });
  it('offers insurance before an Ace peek and locks all other actions', () => {
    const g = reducer(deal('9', 'A', '7', 'K'), { type: 'READY' });
    expect(g.phase).toBe('insurance');
    for (const type of ['READY', 'HIT', 'SURRENDER', 'DEAL', 'RESET'] as const)
      expect(reducer(g, { type })).toBe(g);
    const peek = reducer(g, { type: 'DECLINE_INSURANCE' });
    expect(peek.phase).toBe('peeking');
    expect(reducer(peek, { type: 'READY' }).balance).toBe(2450);
  });
  it('returns insurance stake plus 2:1 winnings, exactly once', () => {
    const offer = reducer(deal('9', 'A', '7', 'K'), { type: 'READY' });
    const insured = reducer(offer, { type: 'INSURE' });
    expect(insured.balance).toBe(2425);
    expect(reducer(insured, { type: 'INSURE' })).toBe(insured);
    const g = reducer(insured, { type: 'READY' });
    expect(g.balance).toBe(2500);
    expect(g.stats).toMatchObject({
      net: 0,
      wagered: 75,
      losses: 1,
      insuranceWagered: 25,
      insuranceNet: 50,
    });
    expect(g.history[0]).toMatchObject({ net: 0, insuranceBet: 25, insuranceNet: 50 });
    expect(reducer(g, { type: 'READY' })).toBe(g);
  });
  it('loses insurance without blackjack and reconciles a main-hand win', () => {
    let g = reducer(deal('10', 'A', '9', '6'), { type: 'READY' });
    g = reducer(reducer(g, { type: 'INSURE' }), { type: 'READY' });
    expect(g.phase).toBe('player');
    expect(g.balance).toBe(2425);
    g = finish(g);
    expect(g.balance).toBe(2525);
    expect(g.stats.net).toBe(25);
    expect(g.stats.insuranceNet).toBe(-25);
  });
  it.each(['6', 'K'])('insuring a player blackjack gives even-money net against Ace/%s', (hole) => {
    let g = reducer(deal('A', 'A', 'K', hole), { type: 'READY' });
    g = reducer(reducer(g, { type: 'INSURE' }), { type: 'READY' });
    expect(g.balance).toBe(2550);
    expect(g.stats.net).toBe(50);
  });
  it('permits declining when there are not enough credits for insurance', () => {
    const g = { ...reducer(deal('9', 'A', '7', '6'), { type: 'READY' }), balance: 24 };
    expect(reducer(g, { type: 'INSURE' })).toBe(g);
    expect(reducer(g, { type: 'DECLINE_INSURANCE' }).phase).toBe('peeking');
  });
  it('surrenders only the original two-card hand and returns half, including fractional credits', () => {
    let g = newGame([...cards('9', '10', '7', '8'), ...makeShoe()]);
    g = reducer(g, { type: 'BET', amount: 25 });
    g = reducer(reducer(reducer(g, { type: 'DEAL' }), { type: 'READY' }), { type: 'READY' });
    expect(canSurrender(g)).toBe(true);
    g = reducer(g, { type: 'SURRENDER' });
    expect(g.phase).toBe('settled');
    expect(g.balance).toBe(2487.5);
    expect(g.dealer).toHaveLength(2);
    expect(g.hands[0].result).toBe('surrender');
    expect(g.stats).toMatchObject({ net: -12.5, losses: 1, surrenders: 1, pushes: 0 });
    expect(reducer(g, { type: 'SURRENDER' })).toBe(g);
  });
  it('combines surrender and lost insurance without double deductions', () => {
    let g = reducer(deal('9', 'A', '7', '6'), { type: 'READY' });
    g = reducer(reducer(g, { type: 'INSURE' }), { type: 'READY' });
    g = reducer(g, { type: 'SURRENDER' });
    expect(g.balance).toBe(2450);
    expect(g.stats.net).toBe(-50);
    expect(g.history[0].insuranceNet).toBe(-25);
  });
  it('disallows surrender after hitting, splitting, doubling or dealer blackjack', () => {
    const hit = reducer(reducer(ready('5', '8', '6', '9', '2'), { type: 'HIT' }), {
      type: 'READY',
    });
    const split = reducer(reducer(ready('8', '8', '8', '9', '2', '3'), { type: 'SPLIT' }), {
      type: 'READY',
    });
    const doubled = reducer(ready('5', '8', '6', '9', '2'), { type: 'DOUBLE' });
    for (const g of [hit, split, doubled, ready('9', 'A', '7', 'K')]) {
      expect(canSurrender(g)).toBe(false);
      expect(reducer(g, { type: 'SURRENDER' })).toBe(g);
    }
  });
  it('migrates old saved sessions and resumes insurance / peek without charging twice', () => {
    const old = JSON.parse(JSON.stringify(finish(ready('10', '8', '9', '9'))));
    delete old.insuranceBet;
    delete old.stats.refills;
    delete old.stats.surrenders;
    delete old.stats.insuranceNet;
    delete old.stats.insuranceWagered;
    old.history.forEach((r: any) => {
      delete r.insuranceBet;
      delete r.insuranceNet;
    });
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(old) });
    expect(loadGame()).toMatchObject({
      balance: old.balance,
      stats: { net: old.stats.net, surrenders: 0, refills: 0 },
      insuranceBet: 0,
    });
    for (const insured of [false, true]) {
      let g = reducer(deal('9', 'A', '7', 'K'), { type: 'READY' });
      if (insured) g = reducer(g, { type: 'INSURE' });
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(g) });
      const restored = loadGame();
      expect(restored).toEqual(g);
      expect(finish(restored).balance).toBe(insured ? 2500 : 2450);
    }
    vi.unstubAllGlobals();
  });
});
