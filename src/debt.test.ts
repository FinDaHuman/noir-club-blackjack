import { describe, expect, it, vi } from 'vitest';
import {
  canDeal,
  canDouble,
  canRefill,
  canSplit,
  loadGame,
  makeShoe,
  maxBet,
  newGame,
  reducer,
  type Card,
  type Game,
} from './game';
import { decisionFeedback } from './coaching';

function start(ranks: string[], balance = 50) {
  const cards = ranks.map((rank, i): Card => ({ rank, id: `debt-${i}`, suit: 'spades' }));
  let game = reducer({ ...newGame([...cards, ...makeShoe()]), balance }, { type: 'DEAL' });
  game = reducer(game, { type: 'READY' });
  if (game.phase === 'peeking') game = reducer(game, { type: 'READY' });
  return game;
}

function finish(game: Game) {
  for (let i = 0; i < 40 && game.phase !== 'settled'; i++) {
    game = reducer(game, {
      type: game.phase === 'player' ? 'STAND' : game.phase === 'dealer' ? 'DEALER_TICK' : 'READY',
    });
  }
  expect(game.phase).toBe('settled');
  return game;
}

function restore(game: Game) {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(game) });
  try {
    return loadGame();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('explicit bankroll debt', () => {
  it.each(['DOUBLE', 'SPLIT'] as const)('requires consent for an unaffordable %s', (type) => {
    const game = start(['8', '10', '8', '9', '10'], 75);
    expect(game.balance).toBe(25);
    expect(reducer(game, { type })).toBe(game);
    const next = reducer(game, { type, allowDebt: true });
    expect(next.balance).toBe(-25);
    expect(next.continueDebt).toBe(true);
    expect(next.stats.refills).toBe(0);
    expect(next.accuracy!.decisions).toHaveLength(1);
  });

  it('does not bypass card rules, the four-hand limit, or animation phases', () => {
    const game = start(['9', '10', '7', '9', '2']);
    expect(reducer(game, { type: 'SPLIT', allowDebt: true })).toBe(game);
    const hit = reducer(reducer(game, { type: 'HIT' }), { type: 'READY' });
    expect(reducer(hit, { type: 'DOUBLE', allowDebt: true })).toBe(hit);
    const doubled = reducer(game, { type: 'DOUBLE', allowDebt: true });
    expect(reducer(doubled, { type: 'DOUBLE', allowDebt: true })).toBe(doubled);
    let split = start(['8', '10', '8', '9', '8', '8', '8']);
    for (let count = 2; count <= 4; count++) {
      if (count === 2) expect(reducer(split, { type: 'SPLIT' })).toBe(split);
      split = reducer(split, count === 2 ? { type: 'SPLIT', allowDebt: true } : { type: 'SPLIT' });
      expect(split.balance).toBe(-(count - 1) * 50);
      split = reducer(reducer(split, { type: 'READY' }), { type: 'READY' });
    }
    expect(canSplit(split, true)).toBe(false);
    expect(reducer(split, { type: 'SPLIT', allowDebt: true })).toBe(split);
    const aces = reducer(
      reducer(start(['A', '6', 'A', '10', 'A']), {
        type: 'SPLIT',
        allowDebt: true,
      }),
      { type: 'READY' },
    );
    expect(canSplit({ ...aces, phase: 'player' }, true)).toBe(false);
    expect(canDouble({ ...aces, phase: 'player' }, true)).toBe(false);
  });

  it('uses the original consent to double a split hand and reconciles all hands', () => {
    let game = start(['8', '6', '8', '10', '3', '2', '10', '5']);
    game = reducer(game, { type: 'SPLIT', allowDebt: true });
    expect(restore(game)).toMatchObject({ balance: -50, phase: 'splitting', hands: game.hands });
    game = reducer(reducer(game, { type: 'READY' }), { type: 'READY' });
    expect(canDouble(game, true)).toBe(true);
    const action = { type: 'DOUBLE' } as const;
    expect(decisionFeedback(game, action)).toMatchObject({ expected: 'DOUBLE', correct: true });
    game = reducer(game, action);
    expect(game.balance).toBe(-100);
    expect(game.hands.map((hand) => hand.bet)).toEqual([100, 50]);
    expect(game.accuracy!.decisions.at(-1)).toMatchObject({ chosen: 'DOUBLE', correct: true });
    game = reducer(reducer(game, { type: 'READY' }), { type: 'READY' });
    expect(game.active).toBe(1);
    game = finish(game);
    expect(game).toMatchObject({
      balance: -100,
      continueDebt: true,
      stats: { net: -150, hands: 2 },
    });
    expect(game.history[0]).toMatchObject({ balance: -100, wager: 150, net: -150 });
    expect(game.balance).toBe(50 + game.stats.net);
  });

  it('requires the first consent when debt starts on a previously funded split hand', () => {
    let game = start(['8', '6', '8', '10', '3', '2', '10', '5'], 100);
    game = reducer(game, { type: 'SPLIT' });
    expect(game).toMatchObject({ balance: 0, continueDebt: false });
    game = reducer(reducer(game, { type: 'READY' }), { type: 'READY' });
    expect(reducer(game, { type: 'DOUBLE' })).toBe(game);
    game = reducer(game, { type: 'DOUBLE', allowDebt: true });
    expect(game).toMatchObject({ balance: -50, continueDebt: true });
    expect(finish(game)).toMatchObject({ balance: -50, continueDebt: true, stats: { net: -150 } });
  });

  it('preserves debt and consent across reload and continued wagers until a deliberate reset', () => {
    const settled = finish(
      reducer(start(['9', '10', '7', '9', '10']), {
        type: 'DOUBLE',
        allowDebt: true,
      }),
    );
    expect(settled.balance).toBe(-50);
    const restored = restore(settled);
    expect(restored).toMatchObject({ phase: 'betting', balance: -50, continueDebt: true });
    expect(reducer(restored, { type: 'REFILL' })).toBe(restored);
    const kept = restored;
    expect(kept.stats).toEqual(settled.stats);
    expect(kept.history).toEqual(settled.history);
    expect(canDeal(kept)).toBe(true);
    expect(canRefill(kept)).toBe(false);
    expect(maxBet(kept)).toBe(500);
    expect(restore(kept)).toMatchObject({
      balance: -50,
      continueDebt: true,
    });
    const nextShoe = ['10', '10', '8', '9'].map((rank, i): Card => ({
      rank,
      id: `next-${i}`,
      suit: 'clubs',
    }));
    const next = finish(reducer({ ...kept, shoe: [...nextShoe, ...makeShoe()] }, { type: 'DEAL' }));
    expect(next).toMatchObject({
      balance: -100,
      continueDebt: true,
      stats: { net: -150, rounds: 2 },
    });
    expect(reducer(kept, { type: 'BET', amount: 1000 }).bet).toBe(500);
    const reset = reducer(next, { type: 'RESET' });
    expect(reset).toMatchObject({
      balance: 2500,
      continueDebt: false,
      stats: { net: 0, hands: 0 },
      history: [],
    });
  });

  it('uses actual payouts to repay debt without adding credits or offering a debt prompt', () => {
    const game = finish(
      reducer(start(['5', '6', '6', '10', '10', '10']), {
        type: 'DOUBLE',
        allowDebt: true,
      }),
    );
    expect(game).toMatchObject({
      balance: 150,
      continueDebt: false,
      stats: { net: 100, refills: 0 },
    });
    expect(game.balance).toBe(50 + game.stats.net);
    const nextCards = ['5', '9', '6', '8'].map((rank, i): Card => ({
      rank,
      id: `recover-${i}`,
      suit: 'clubs',
    }));
    const next = reducer(
      reducer({ ...game, bet: 100, shoe: [...nextCards, ...makeShoe()] }, { type: 'DEAL' }),
      { type: 'READY' },
    );
    expect(next.balance).toBe(50);
    expect(canDouble(next)).toBe(false);
    expect(reducer(next, { type: 'DOUBLE' })).toBe(next);
    expect(reducer(next, { type: 'DOUBLE', allowDebt: true })).toMatchObject({
      balance: -50,
      continueDebt: true,
    });
  });

  it('keeps consent at zero and clears it only when the bankroll is strictly positive', () => {
    const zero = finish(
      reducer(start(['8', '10', '8', '8', '10', '2']), { type: 'SPLIT', allowDebt: true }),
    );
    expect(zero).toMatchObject({ balance: 0, continueDebt: true });
    expect(canDeal(zero)).toBe(true);
    expect(canRefill(zero)).toBe(false);
    expect(restore(zero)).toMatchObject({ balance: 0, continueDebt: true });
  });
});
