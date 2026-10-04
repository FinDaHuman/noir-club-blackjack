import { describe, expect, it } from 'vitest';
import { advise, chartMove, currentAdvice, DEALER_CARDS, type HandKind } from './strategy';
import { makeShoe, newGame, reducer, type Card } from './game';

// Independent full chart fixture verified against Wizard of Odds, 4–8 decks / S17 / DAS / late surrender.
const fixtures: [HandKind, number, string][] = [
  ['hard', 8, 'H H H H H H H H H H'],
  ['hard', 9, 'H Dh Dh Dh Dh H H H H H'],
  ['hard', 10, 'Dh Dh Dh Dh Dh Dh Dh Dh H H'],
  ['hard', 11, 'Dh Dh Dh Dh Dh Dh Dh Dh Dh H'],
  ['hard', 12, 'H H S S S H H H H H'],
  ['hard', 13, 'S S S S S H H H H H'],
  ['hard', 14, 'S S S S S H H H H H'],
  ['hard', 15, 'S S S S S H H H Rh H'],
  ['hard', 16, 'S S S S S H H Rh Rh Rh'],
  ['hard', 17, 'S S S S S S S S S S'],
  ['soft', 13, 'H H H Dh Dh H H H H H'],
  ['soft', 14, 'H H H Dh Dh H H H H H'],
  ['soft', 15, 'H H Dh Dh Dh H H H H H'],
  ['soft', 16, 'H H Dh Dh Dh H H H H H'],
  ['soft', 17, 'H Dh Dh Dh Dh H H H H H'],
  ['soft', 18, 'S Ds Ds Ds Ds S S H H H'],
  ['soft', 19, 'S S S S S S S S S S'],
  ['soft', 20, 'S S S S S S S S S S'],
  ['pair', 2, 'P P P P P P H H H H'],
  ['pair', 3, 'P P P P P P H H H H'],
  ['pair', 4, 'H H H P P H H H H H'],
  ['pair', 5, 'Dh Dh Dh Dh Dh Dh Dh Dh H H'],
  ['pair', 6, 'P P P P P H H H H H'],
  ['pair', 7, 'P P P P P P H H H H'],
  ['pair', 8, 'P P P P P P P P P P'],
  ['pair', 9, 'P P P P P S P P S S'],
  ['pair', 10, 'S S S S S S S S S S'],
  ['pair', 11, 'P P P P P P P P P P'],
];

describe('strategy chart and available-action adviser', () => {
  it.each(fixtures)(
    '%s %s agrees with the reference across every upcard',
    (kind, total, expected) => {
      expect(DEALER_CARDS.map((d) => chartMove(kind, total, d))).toEqual(expected.split(' '));
    },
  );
  it('applies double, surrender and split fallbacks to unavailable actions', () => {
    const blocked = { double: false, split: false, surrender: false };
    expect(advise('soft', 18, 6, blocked).name).toBe('Stand');
    expect(advise('hard', 11, 6, blocked).name).toBe('Hit');
    expect(advise('hard', 16, 10, blocked).name).toBe('Hit');
    expect(advise('pair', 8, 10, blocked).name).toBe('Hit');
    expect(advise('pair', 8, 10, { ...blocked, surrender: true }).name).toBe('Surrender');
    expect(advise('pair', 11, 6, blocked).name).toBe('Hit');
  });
  it('uses only visible player cards and upcard for current-hand advice', () => {
    const cards: Card[] = ['8', '10', '8', '6'].map((rank, i) => ({
      id: String(i),
      rank,
      suit: 'spades',
    }));
    let g = reducer(newGame([...cards, ...makeShoe()]), { type: 'DEAL' });
    g = reducer(reducer(g, { type: 'READY' }), { type: 'READY' });
    expect(currentAdvice(g)?.name).toBe('Split');
    expect(currentAdvice({ ...g, dealer: [g.dealer[0], { ...g.dealer[1], rank: 'K' }] })).toEqual(
      currentAdvice(g),
    );
    expect(currentAdvice({ ...g, balance: 0 })?.name).toBe('Surrender');
    expect(currentAdvice({ ...g, phase: 'insurance' })?.name).toBe('Decline insurance');
    expect(currentAdvice(newGame())).toBeNull();
  });
});
