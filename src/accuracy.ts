export const DECISION_LABELS = {
  HIT: 'Hit',
  STAND: 'Stand',
  DOUBLE: 'Double',
  SPLIT: 'Split',
  SURRENDER: 'Surrender',
  INSURE: 'Take insurance',
  DECLINE_INSURANCE: 'Decline insurance',
} as const;
export type DecisionAction = keyof typeof DECISION_LABELS;
export type Decision = {
  id: number;
  hand: number;
  source: 'original' | 'split' | 'insurance';
  cards: string[];
  total: number;
  soft: boolean;
  upcard: string;
  chosen: DecisionAction;
  expected: DecisionAction;
  correct: boolean;
  explanation: string;
  available: { double: boolean; split: boolean; surrender: boolean };
};
export type DecisionAudit = { version: 1; decisions: Decision[] };
export type HandGrade = { decisionIds: number[]; correct: boolean | null };
export type RoundAccuracy = DecisionAudit & { hands: HandGrade[] };
export function gradeHand(decisionIds: number[], decisions: Decision[]): HandGrade {
  return {
    decisionIds: [...decisionIds],
    correct: decisionIds.length
      ? decisionIds.every((id) => decisions.find((d) => d.id === id)?.correct === true)
      : null,
  };
}
export function accuracySummary(accuracy: RoundAccuracy) {
  return {
    decisions: accuracy.decisions.length,
    correctDecisions: accuracy.decisions.filter((d) => d.correct).length,
    hands: accuracy.hands.filter((h) => h.correct !== null).length,
    correctHands: accuracy.hands.filter((h) => h.correct === true).length,
  };
}
export function isDecisionAudit(value: unknown): value is DecisionAudit {
  if (!value || typeof value !== 'object') return false;
  const audit = value as DecisionAudit;
  const card = (c: unknown) => typeof c === 'string' && /^(?:A|[2-9]|10|J|Q|K)[♠♥♦♣]$/.test(c);
  return (
    audit.version === 1 &&
    Array.isArray(audit.decisions) &&
    audit.decisions.length <= 128 &&
    audit.decisions.every(
      (d, i) =>
        d &&
        d.id === i + 1 &&
        [0, 1, 2].includes(d.hand) &&
        ['original', 'split', 'insurance'].includes(d.source) &&
        Array.isArray(d.cards) &&
        d.cards.length >= 2 &&
        d.cards.every(card) &&
        card(d.upcard) &&
        Number.isFinite(d.total) &&
        d.total >= 2 &&
        d.total <= 21 &&
        typeof d.soft === 'boolean' &&
        Object.hasOwn(DECISION_LABELS, d.chosen) &&
        Object.hasOwn(DECISION_LABELS, d.expected) &&
        d.correct === (d.chosen === d.expected) &&
        typeof d.explanation === 'string' &&
        d.available &&
        ['double', 'split', 'surrender'].every(
          (key) => typeof d.available[key as keyof typeof d.available] === 'boolean',
        ),
    )
  );
}
export function validDecisionIds(ids: unknown, audit: DecisionAudit): ids is number[] {
  return (
    Array.isArray(ids) &&
    new Set(ids).size === ids.length &&
    ids.every((id) => Number.isInteger(id) && id >= 1 && id <= audit.decisions.length)
  );
}
export function isRoundAccuracy(value: unknown, handCount: number): value is RoundAccuracy {
  if (!isDecisionAudit(value)) return false;
  const accuracy = value as RoundAccuracy;
  return (
    Array.isArray(accuracy.hands) &&
    accuracy.hands.length === handCount &&
    accuracy.hands.every(
      (hand) =>
        hand &&
        validDecisionIds(hand.decisionIds, accuracy) &&
        hand.correct === gradeHand(hand.decisionIds, accuracy.decisions).correct,
    )
  );
}
