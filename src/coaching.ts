import {
  canDouble,
  canSplit,
  canSurrender,
  currentAdvice,
  score,
  SUITS,
  type Action,
  type Game,
} from './game';
import { DECISION_LABELS, type DecisionAction } from './accuracy';

export type Feedback = {
  chosen: DecisionAction;
  expected: DecisionAction;
  correct: boolean;
  reason: string;
  situation: string;
};

export function situation(game: Game) {
  const hand = game.hands[game.active];
  if (!hand || !game.dealer[0]) return '';
  const total = score(hand.cards);
  return `${hand.split ? `Hand ${game.active + 1} · ` : ''}${hand.cards.map((c) => `${c.rank}${SUITS[c.suit]}`).join(' ')} (${total.soft ? 'soft ' : ''}${total.total}) vs ${game.dealer[0].rank}${SUITS[game.dealer[0].suit]}`;
}

// Capture advice before a legal choice changes cards, funds, or the active split hand.
export function decisionFeedback(game: Game, action: Action): Feedback | null {
  if (!Object.hasOwn(DECISION_LABELS, action.type)) return null;
  const chosen = action.type as DecisionAction;
  const allowDebt =
    game.continueDebt ||
    ((action.type === 'DOUBLE' || action.type === 'SPLIT') && action.allowDebt === true);
  const legal =
    game.phase === 'insurance'
      ? (chosen === 'INSURE' || chosen === 'DECLINE_INSURANCE') &&
        game.balance >= game.hands[0].bet / 2
      : game.phase === 'player' &&
        (chosen === 'HIT' ||
          chosen === 'STAND' ||
          (chosen === 'DOUBLE' && canDouble(game, allowDebt)) ||
          (chosen === 'SPLIT' && canSplit(game, allowDebt)) ||
          (chosen === 'SURRENDER' && canSurrender(game)));
  const advice = legal ? currentAdvice(game, allowDebt) : null;
  return advice
    ? {
        chosen,
        expected: advice.action,
        correct: chosen === advice.action,
        reason: advice.reason,
        situation: situation(game),
      }
    : null;
}
export const shortChoice = (action: DecisionAction) =>
  action === 'INSURE'
    ? 'Insure'
    : action === 'DECLINE_INSURANCE'
      ? 'No insurance'
      : DECISION_LABELS[action];
