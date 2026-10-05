import { describe, expect, it, vi } from 'vitest';
import { accuracySummary, isDecisionAudit, isRoundAccuracy } from './accuracy';
import { currentAdvice, loadGame, makeShoe, newGame, reducer, type Card, type Game } from './game';

const shoe = (...ranks: string[]) => [
  ...ranks.map((rank, i): Card => ({ id: `accuracy-${i}`, rank, suit: 'spades' })),
  ...makeShoe(),
];
function start(...ranks: string[]) {
  let g = reducer(newGame(shoe(...ranks)), { type: 'DEAL' });
  g = reducer(g, { type: 'READY' });
  if (g.phase === 'peeking') g = reducer(g, { type: 'READY' });
  return g;
}
function finish(g: Game): Game {
  for (let n = 0; n < 100 && g.phase !== 'settled'; n++) {
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
  }
  expect(g.phase).toBe('settled');
  return g;
}
function counts(g: Game) {
  return accuracySummary(g.history[0].accuracy!);
}
function load(saved: unknown) {
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) });
  const g = loadGame();
  vi.unstubAllGlobals();
  return g;
}

describe('basic-strategy accuracy accounting', () => {
  it('grades a correct surrender independently of its monetary loss', () => {
    const g = reducer(start('9', '10', '7', '8'), { type: 'SURRENDER' });
    expect(g.history[0].net).toBe(-25);
    expect(counts(g)).toEqual({ decisions: 1, correctDecisions: 1, hands: 1, correctHands: 1 });
    expect(g.history[0].accuracy!.decisions[0]).toMatchObject({
      cards: ['9♠', '7♠'],
      total: 16,
      upcard: '10♠',
      chosen: 'SURRENDER',
      expected: 'SURRENDER',
      correct: true,
    });
  });
  it('records a mistake before the next card and keeps winning hands incorrect', () => {
    let g = start('10', '6', '2', '10', '9', 'K');
    g = reducer(g, { type: 'HIT' }); // 12 vs 6 should stand; the lucky 9 is not part of the decision.
    expect(g.stats.strategyDecisions).toBe(0);
    expect(g.accuracy!.decisions[0]).toMatchObject({
      cards: ['10♠', '2♠'],
      total: 12,
      chosen: 'HIT',
      expected: 'STAND',
      correct: false,
    });
    g = finish(g);
    expect(g.history[0].net).toBe(50);
    expect(counts(g)).toEqual({ decisions: 1, correctDecisions: 0, hands: 1, correctHands: 0 });
  });
  it('records each choice once and publishes aggregates only on settlement', () => {
    const initial = start('5', '10', '6', '7', '2');
    const initialJson = JSON.stringify(initial);
    const hit = reducer(initial, { type: 'HIT' }); // Should double.
    expect(JSON.stringify(initial)).toBe(initialJson);
    expect(reducer(hit, { type: 'HIT' })).toBe(hit);
    expect(reducer(hit, { type: 'DOUBLE' })).toBe(hit);
    let g = reducer(hit, { type: 'READY' });
    expect(g.stats.strategyDecisions).toBe(0);
    expect(g.history).toHaveLength(0);
    g = reducer(g, { type: 'STAND' }); // Hard 13 vs 10 should hit.
    expect(g.stats.strategyDecisions).toBe(0);
    g = finish(g);
    expect(counts(g)).toMatchObject({
      decisions: 2,
      correctDecisions: 0,
      hands: 1,
      correctHands: 0,
    });
    expect(g.stats.strategyDecisions).toBe(2);
    const frozen = JSON.stringify(g);
    expect(reducer(g, { type: 'DEALER_TICK' })).toBe(g);
    expect(JSON.stringify(g)).toBe(frozen);
  });
  it('does not record rejected actions or include bet and dealer events', () => {
    let g = start('5', '8', '6', '9', '10');
    for (const type of [
      'SPLIT',
      'INSURE',
      'DECLINE_INSURANCE',
      'DEALER_TICK',
      'READY',
      'RESET',
    ] as const)
      expect(reducer(g, { type })).toBe(g);
    expect(g.accuracy!.decisions).toHaveLength(0);
    g = finish(reducer(g, { type: 'DOUBLE' }));
    expect(counts(g).decisions).toBe(1);
    expect(counts(g).correctDecisions).toBe(1);
  });
  it('uses the affordable fallback before deducting a doubled wager', () => {
    let g = { ...start('5', '6', '6', '10', '10', '5'), balance: 0 };
    expect(currentAdvice(g)?.action).toBe('HIT');
    g = finish(reducer(g, { type: 'HIT' }));
    expect(g.history[0].accuracy!.decisions[0]).toMatchObject({
      expected: 'HIT',
      correct: true,
      available: { double: false },
    });
    const doubled = finish(
      reducer({ ...start('5', '6', '6', '10', '10', '5'), balance: 50 }, { type: 'DOUBLE' }),
    );
    expect(doubled.history[0].accuracy!.decisions[0]).toMatchObject({
      expected: 'DOUBLE',
      correct: true,
      available: { double: true },
    });
  });
  it('falls back to stand on soft 18 when doubling is unaffordable', () => {
    const g = finish(
      reducer({ ...start('A', '6', '7', '10', '5'), balance: 0 }, { type: 'STAND' }),
    );
    expect(g.history[0].accuracy!.decisions[0]).toMatchObject({
      soft: true,
      total: 18,
      expected: 'STAND',
      correct: true,
    });
  });
  it('uses hit instead of unavailable surrender after a hit', () => {
    let g = start('5', '10', '6', '7', '5', '5');
    g = reducer(reducer(g, { type: 'HIT' }), { type: 'READY' });
    g = finish(reducer(g, { type: 'HIT' }));
    expect(g.history[0].accuracy!.decisions.map((d) => [d.expected, d.correct])).toEqual([
      ['DOUBLE', false],
      ['HIT', true],
    ]);
    expect(counts(g)).toEqual({ decisions: 2, correctDecisions: 1, hands: 1, correctHands: 0 });
  });
  it('grades split hands independently while counting the split choice once', () => {
    let g = start('8', '6', '8', '10', '3', '10', '2', '5');
    g = reducer(reducer(g, { type: 'SPLIT' }), { type: 'READY' });
    g = reducer(g, { type: 'READY' });
    g = reducer(reducer(g, { type: 'DOUBLE' }), { type: 'READY' });
    g = reducer(g, { type: 'READY' });
    g = finish(reducer(g, { type: 'STAND' }));
    expect(counts(g)).toEqual({ decisions: 3, correctDecisions: 2, hands: 2, correctHands: 1 });
    expect(g.history[0].accuracy!.hands).toEqual([
      { decisionIds: [1, 2], correct: true },
      { decisionIds: [1, 3], correct: false },
    ]);
    expect(g.history[0].accuracy!.decisions.map((d) => d.hand)).toEqual([0, 1, 2]);
  });
  it('carries a mistaken split into both resulting hands', () => {
    let g = start('10', '6', '10', '10', '2', '8', '5');
    g = finish(reducer(g, { type: 'SPLIT' }));
    expect(counts(g)).toEqual({ decisions: 3, correctDecisions: 2, hands: 2, correctHands: 0 });
  });
  it('grades four re-split hands with shared ancestry and the correct limit fallback', () => {
    let g = start('3', '6', '3', '10', '3', '3', '3', '7', '9', '10', '10', '5');
    for (let i = 0; i < 3; i++) {
      expect(currentAdvice(g)?.action).toBe('SPLIT');
      for (const type of ['SPLIT', 'READY', 'READY'] as const) g = reducer(g, { type });
    }
    expect(currentAdvice(g)?.action).toBe('HIT');
    g = reducer(reducer(g, { type: 'HIT' }), { type: 'READY' });
    g = finish(g);
    expect(counts(g)).toEqual({ decisions: 8, correctDecisions: 8, hands: 4, correctHands: 4 });
    expect(g.history[0].accuracy!.hands).toEqual([
      { decisionIds: [1, 2, 3, 4, 5], correct: true },
      { decisionIds: [1, 2, 3, 6], correct: true },
      { decisionIds: [1, 2, 7], correct: true },
      { decisionIds: [1, 8], correct: true },
    ]);
    expect(g.accuracy!.decisions.at(-1)?.hand).toBe(4);
    expect(isDecisionAudit(g.accuracy)).toBe(true);
    expect(isRoundAccuracy(g.history[0].accuracy, 4)).toBe(true);
    expect(load(g).history[0].accuracy).toEqual(g.history[0].accuracy);
    expect(load(g).stats.strategyCorrectHands).toBe(4);
  });
  it('counts a split-aces choice, but not their forced extra cards', () => {
    const g = finish(reducer(start('A', '6', 'A', '10', 'K', '9', '5'), { type: 'SPLIT' }));
    expect(counts(g)).toEqual({ decisions: 1, correctDecisions: 1, hands: 2, correctHands: 2 });
  });
  it('grades insurance choices independently of whether insurance wins', () => {
    const offer = start('9', 'A', '7', 'K');
    const g = finish(reducer(offer, { type: 'INSURE' }));
    expect(g.history[0].insuranceNet).toBe(50);
    expect(counts(g)).toEqual({ decisions: 1, correctDecisions: 0, hands: 1, correctHands: 0 });
    expect(g.history[0].accuracy!.decisions[0]).toMatchObject({
      source: 'insurance',
      chosen: 'INSURE',
      expected: 'DECLINE_INSURANCE',
      correct: false,
    });
    expect(counts(finish(reducer(offer, { type: 'DECLINE_INSURANCE' }))).correctHands).toBe(1);
  });
  it('carries a shared insurance choice into both split hands without double-counting', () => {
    let g = start('8', 'A', '8', '6', '10', '10');
    g = reducer(reducer(g, { type: 'INSURE' }), { type: 'READY' });
    g = finish(reducer(g, { type: 'SPLIT' }));
    expect(counts(g)).toMatchObject({ decisions: 4, correctHands: 0, hands: 2 });
    expect(g.history[0].accuracy!.hands.every((h) => h.decisionIds.includes(1))).toBe(true);
  });
  it('excludes forced insurance declines and hands with no decision', () => {
    const g = finish(
      reducer({ ...start('9', 'A', '7', 'K'), balance: 0 }, { type: 'DECLINE_INSURANCE' }),
    );
    expect(counts(g)).toEqual({ decisions: 0, correctDecisions: 0, hands: 0, correctHands: 0 });
    for (const natural of [start('A', '9', 'K', '8'), start('9', '10', '7', 'A')]) {
      expect(counts(natural).hands).toBe(0);
      expect(natural.history[0].accuracy!.hands[0].correct).toBeNull();
    }
  });
  it('persists an unfinished tracked hand and settles its accuracy once after reload', () => {
    let g = reducer(start('5', '10', '6', '7', '2'), { type: 'HIT' });
    const restored = load(g);
    expect(restored).toEqual(g);
    g = finish(restored);
    expect(counts(g).decisions).toBe(2);
    const reopened = load(g);
    expect(reopened.phase).toBe('betting');
    expect(reopened.stats.strategyDecisions).toBe(2);
    expect(reopened.accuracy).toBeNull();
  });
  it('keeps older hands and old unfinished rounds ungraded while preserving session stats', () => {
    const old = JSON.parse(JSON.stringify(start('9', '10', '7', '8')));
    delete old.accuracy;
    old.hands.forEach((h: any) => delete h.decisionIds);
    for (const key of [
      'strategyDecisions',
      'strategyCorrectDecisions',
      'strategyHands',
      'strategyCorrectHands',
    ])
      delete old.stats[key];
    let g = finish(load(old));
    expect(g.history[0].accuracy).toBeNull();
    expect(g.stats.strategyDecisions).toBe(0);
    expect(g.stats.rounds).toBe(1);
    const balance = g.balance;
    g = reducer({ ...g, shoe: shoe('9', '10', '7', '8') }, { type: 'DEAL' });
    g = reducer(reducer(g, { type: 'READY' }), { type: 'READY' });
    g = reducer(g, { type: 'SURRENDER' });
    expect(g.stats.strategyHands).toBe(1);
    expect(g.stats.rounds).toBe(2);
    expect(g.balance).toBe(balance - 25);
    const legacy = JSON.parse(JSON.stringify(g));
    legacy.history.forEach((r: any) => delete r.accuracy);
    expect(load(legacy).history.every((r) => r.accuracy === null)).toBe(true);
  });
  it('does not let corrupted accuracy data destroy the bankroll or create partial grades', () => {
    const g = reducer(start('5', '10', '6', '7', '2'), { type: 'HIT' });
    const invalid = JSON.parse(JSON.stringify(g));
    invalid.accuracy.decisions[0].correct = true;
    expect(isDecisionAudit(invalid.accuracy)).toBe(false);
    const restored = load(invalid);
    expect(restored.balance).toBe(g.balance);
    expect(restored.accuracy).toBeNull();
    expect(finish(restored).history[0].accuracy).toBeNull();
    const settled = finish(g);
    expect(isRoundAccuracy(settled.history[0].accuracy, 1)).toBe(true);
    settled.history[0].accuracy!.hands[0].decisionIds.push(999);
    expect(load(settled).history[0].accuracy).toBeNull();
  });
  it('retains lifetime accuracy after history truncation and resets it with the session', () => {
    let g = { ...newGame(), bet: 10 };
    for (let n = 0; n < 105; n++) {
      g = reducer({ ...g, shoe: shoe('9', '10', '7', '8') }, { type: 'DEAL' });
      g = reducer(reducer(g, { type: 'READY' }), { type: 'READY' });
      g = reducer(g, { type: 'SURRENDER' });
    }
    expect(g.history).toHaveLength(100);
    expect(g.stats.strategyHands).toBe(105);
    expect(g.stats.strategyCorrectDecisions).toBe(105);
    const fresh = reducer(g, { type: 'RESET' });
    expect(fresh.stats.strategyDecisions).toBe(0);
    expect(fresh.history).toHaveLength(0);
    expect(fresh.accuracy).toBeNull();
  });
});
