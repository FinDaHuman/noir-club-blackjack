import { describe, expect, it, vi } from 'vitest';
import {
  canDouble,
  canSplit,
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
  return reducer(deal(...ranks), { type: 'READY' });
}
function finish(state: Game) {
  let g = state;
  for (let i = 0; i < 100 && g.phase !== 'settled'; i++)
    g = reducer(g, {
      type: g.phase === 'player' ? 'STAND' : g.phase === 'dealer' ? 'DEALER_TICK' : 'READY',
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
    const hit = reducer(reducer(g, { type: 'READY' }), { type: 'HIT' });
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
    expect(g.hands.map((h) => h.cards.map((c) => c.rank))).toEqual([
      ['8', '2'],
      ['8', '3'],
    ]);
    g = reducer(g, { type: 'READY' });
    expect(canSplit(g)).toBe(false);
    g = reducer(g, { type: 'STAND' });
    expect(g.active).toBe(1);
    expect(g.phase).toBe('player');
    expect(finish(g).stats.hands).toBe(2);
  });
  it('allows double after split', () => {
    let g = reducer(ready('8', '10', '8', '7', '3', '2', 'K'), { type: 'SPLIT' });
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
    expect(g.active).toBe(1);
    expect(g.phase).toBe('player');
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
      if (g.balance < 10) g = reducer(g, { type: 'RESET' });
      g = reducer(g, { type: 'BET', amount: 10 });
      g = finish(reducer(g, { type: 'DEAL' }));
      expect(g.balance).toBe(2500 + g.stats.net);
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
