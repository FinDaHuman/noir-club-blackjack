import { describe, expect, it } from 'vitest';
import { decisionFeedback } from './coaching';
import { makeShoe, newGame, reducer, type Action, type Card } from './game';

function start(ranks: string[], balance = 2500) {
  const cards = ranks.map((rank, i): Card => ({ rank, id: `coach-${i}`, suit: 'hearts' }));
  let game = reducer({ ...newGame([...cards, ...makeShoe()]), balance }, { type: 'DEAL' });
  game = reducer(game, { type: 'READY' });
  if (game.phase === 'peeking') game = reducer(game, { type: 'READY' });
  return game;
}

describe('optional coaching', () => {
  it.each([
    { ranks: ['10', '6', '2', '10', '9'], type: 'HIT', expected: 'STAND', correct: false },
    { ranks: ['10', '6', '2', '10'], type: 'STAND', expected: 'STAND', correct: true },
    { ranks: ['5', '9', '6', '8', 'K'], type: 'DOUBLE', expected: 'DOUBLE', correct: true },
    { ranks: ['A', '6', 'A', '10'], type: 'SPLIT', expected: 'SPLIT', correct: true },
    { ranks: ['9', '10', '7', '8'], type: 'SURRENDER', expected: 'SURRENDER', correct: true },
    { ranks: ['9', 'A', '7', 'K'], type: 'INSURE', expected: 'DECLINE_INSURANCE', correct: false },
    {
      ranks: ['9', 'A', '7', 'K'],
      type: 'DECLINE_INSURANCE',
      expected: 'DECLINE_INSURANCE',
      correct: true,
    },
  ] as const)(
    'matches the tracker for $type without seeing future cards',
    ({ ranks, type, expected, correct }) => {
      const game = start([...ranks]);
      const frozen = JSON.stringify(game);
      const feedback = decisionFeedback(game, { type });
      expect(feedback).toMatchObject({ chosen: type, expected, correct });
      expect(JSON.stringify(game)).toBe(frozen);
      const next = reducer(game, { type });
      const recorded = (next.accuracy ?? next.history[0]?.accuracy)!.decisions.at(-1)!;
      expect(feedback).toMatchObject({
        expected: recorded.expected,
        correct: recorded.correct,
        reason: recorded.explanation,
      });
    },
  );
  it('uses only the visible upcard and respects available funds and actions', () => {
    const a = start(['5', '9', '6', '8', 'K'], 50);
    const b = start(['5', '9', '6', '10', '2'], 50);
    expect(decisionFeedback(a, { type: 'HIT' })).toEqual(decisionFeedback(b, { type: 'HIT' }));
    expect(decisionFeedback(a, { type: 'HIT' })).toMatchObject({ expected: 'HIT', correct: true });
    expect(decisionFeedback(a, { type: 'DOUBLE' })).toBeNull();
    const hit = reducer(reducer(start(['9', '10', '7', '8', '2']), { type: 'HIT' }), {
      type: 'READY',
    });
    expect(decisionFeedback(hit, { type: 'SURRENDER' })).toBeNull();
  });
  it('ignores rejected choices, automatic dealing, and forced insurance declines', () => {
    const game = start(['10', '8', '6', '9']);
    for (const type of ['SPLIT', 'INSURE', 'DEAL', 'READY', 'RESET', 'REFILL'] as const)
      expect(decisionFeedback(game, { type } as Action)).toBeNull();
    expect(decisionFeedback(reducer(game, { type: 'HIT' }), { type: 'HIT' })).toBeNull();
    expect(
      decisionFeedback(start(['10', 'A', '6', '9'], 50), { type: 'DECLINE_INSURANCE' }),
    ).toBeNull();
  });
  it('identifies the active split hand before switching to the next hand', () => {
    let game = reducer(start(['8', '6', '8', '10', '10', '9']), { type: 'SPLIT' });
    game = reducer(reducer(game, { type: 'READY' }), { type: 'READY' });
    expect(decisionFeedback(game, { type: 'STAND' })?.situation).toContain('Hand 1');
    game = reducer(reducer(game, { type: 'STAND' }), { type: 'READY' });
    expect(decisionFeedback(game, { type: 'STAND' })?.situation).toContain('Hand 2');
  });
});
