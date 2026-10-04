import { canDouble, canSplit, canSurrender, score, value, type Game } from './game';

export type HandKind = 'hard' | 'soft' | 'pair';
export type Move = 'H' | 'S' | 'Dh' | 'Ds' | 'P' | 'Rh';
export const DEALER_CARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const MOVE_NAMES: Record<Move, string> = {
  H: 'Hit',
  S: 'Stand',
  Dh: 'Double · otherwise hit',
  Ds: 'Double · otherwise stand',
  P: 'Split',
  Rh: 'Surrender · otherwise hit',
};
export const cardName = (n: number) => (n === 11 ? 'A' : String(n));
// Total-dependent basic strategy: 4–8 decks, S17, American peek, DAS, late surrender.
// Verified against https://wizardofodds.com/games/blackjack/strategy/calculator/
export function chartMove(kind: HandKind, total: number, dealer: number): Move {
  if (kind === 'pair') {
    if (total === 11 || total === 8) return 'P';
    if (total === 10) return 'S';
    if (total === 9) return [7, 10, 11].includes(dealer) ? 'S' : 'P';
    if ((total === 2 || total === 3 || total === 7) && dealer <= 7) return 'P';
    if (total === 6 && dealer <= 6) return 'P';
    if (total === 4 && [5, 6].includes(dealer)) return 'P';
    return chartMove('hard', total * 2, dealer);
  }
  if (kind === 'soft') {
    if (total >= 19) return 'S';
    if (total === 18) return dealer >= 9 ? 'H' : dealer >= 3 && dealer <= 6 ? 'Ds' : 'S';
    if (total === 17 && dealer >= 3 && dealer <= 6) return 'Dh';
    if ([15, 16].includes(total) && dealer >= 4 && dealer <= 6) return 'Dh';
    if ([13, 14].includes(total) && [5, 6].includes(dealer)) return 'Dh';
    return 'H';
  }
  if (total >= 17) return 'S';
  if ((total === 16 && dealer >= 9) || (total === 15 && dealer === 10)) return 'Rh';
  if (total >= 13 && dealer <= 6) return 'S';
  if (total === 12 && dealer >= 4 && dealer <= 6) return 'S';
  if (total === 11 && dealer <= 10) return 'Dh';
  if (total === 10 && dealer <= 9) return 'Dh';
  if (total === 9 && dealer >= 3 && dealer <= 6) return 'Dh';
  return 'H';
}
export function advise(
  kind: HandKind,
  total: number,
  dealer: number,
  allowed = { double: true, split: true, surrender: true },
) {
  let move = chartMove(kind, total, dealer);
  let fallback = '';
  if (move === 'P' && !allowed.split) {
    move = chartMove(total === 11 ? 'soft' : 'hard', total === 11 ? 12 : total * 2, dealer);
    fallback = 'Splitting is unavailable. Play this as a total instead. ';
  }
  if ((move === 'Dh' || move === 'Ds') && !allowed.double) {
    move = move === 'Dh' ? 'H' : 'S';
    fallback += 'Doubling is unavailable. Use the chart’s fallback. ';
  }
  if (move === 'Rh' && !allowed.surrender) {
    move = 'H';
    fallback += 'Late surrender is unavailable after a hit or split. ';
  }
  const reasons: Record<Move, string> = {
    H: 'Take another card. This total benefits more from improving the hand than from standing against this upcard.',
    S: 'Keep this total. The extra card is not worth the risk against this upcard.',
    Dh: 'Add an equal wager and take exactly one card. If you cannot double, hit.',
    Ds: 'Add an equal wager and take exactly one card. If you cannot double, keep your soft 18 and stand.',
    P: 'Separate the pair into two hands with equal wagers. The pair table takes priority over the total table.',
    Rh: 'Return half the original wager and end the hand. If surrender is unavailable, hit.',
  };
  return {
    move,
    name: move.startsWith('D') ? 'Double' : move === 'Rh' ? 'Surrender' : MOVE_NAMES[move],
    reason: fallback + reasons[move],
  };
}
export function currentAdvice(game: Game) {
  if (game.phase === 'insurance')
    return {
      name: 'Decline insurance',
      reason:
        'Basic strategy declines this side bet, even with a player blackjack. A 2:1 payout needs a blackjack probability above one third to be profitable.',
    };
  if (game.phase !== 'player') return null;
  const hand = game.hands[game.active];
  const points = score(hand.cards);
  const pair = hand.cards.length === 2 && hand.cards[0].rank === hand.cards[1].rank;
  return advise(
    pair ? 'pair' : points.soft ? 'soft' : 'hard',
    pair ? value(hand.cards[0]) : points.total,
    value(game.dealer[0]),
    {
      double: canDouble(game),
      split: canSplit(game),
      surrender: canSurrender(game),
    },
  );
}
