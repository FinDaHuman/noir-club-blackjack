import { advise, type Move } from './strategy';
import {
  accuracySummary,
  gradeHand,
  isDecisionAudit,
  isRoundAccuracy,
  validDecisionIds,
  type DecisionAction,
  type DecisionAudit,
  type RoundAccuracy,
} from './accuracy';

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Card = { id: string; rank: string; suit: Suit };
export type Result = 'blackjack' | 'win' | 'loss' | 'push' | 'surrender';
export type Hand = {
  cards: Card[];
  bet: number;
  stood: boolean;
  split: boolean;
  result?: Result;
  decisionIds?: number[];
};
export type Round = {
  id: number;
  time: string;
  player: string[];
  dealer: number;
  wager: number;
  net: number;
  balance: number;
  results: Result[];
  insuranceBet: number;
  insuranceNet: number;
  accuracy: RoundAccuracy | null;
};
export type Stats = {
  refills: number;
  rounds: number;
  hands: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  wagered: number;
  net: number;
  bestWin: number;
  streak: number;
  bestStreak: number;
  surrenders: number;
  insuranceWagered: number;
  insuranceNet: number;
  strategyDecisions: number;
  strategyCorrectDecisions: number;
  strategyHands: number;
  strategyCorrectHands: number;
};
export type Game = {
  version: 1;
  phase:
    | 'betting'
    | 'dealing'
    | 'insurance'
    | 'peeking'
    | 'player'
    | 'hitting'
    | 'splitting'
    | 'split-dealing'
    | 'dealer'
    | 'settled';
  balance: number;
  bet: number;
  shoe: Card[];
  dealer: Card[];
  hands: Hand[];
  active: number;
  insuranceBet: number;
  accuracy: DecisionAudit | null;
  stats: Stats;
  history: Round[];
  message: string;
};
export type Action =
  | { type: 'BET'; amount: number }
  | {
      type:
        | 'DEAL'
        | 'READY'
        | 'HIT'
        | 'STAND'
        | 'DOUBLE'
        | 'SPLIT'
        | 'INSURE'
        | 'DECLINE_INSURANCE'
        | 'SURRENDER'
        | 'DEALER_TICK'
        | 'REFILL'
        | 'RESET';
    };

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const BANKROLL_REFILL = 2500;
export const MAX_HANDS = 4;
export const SUITS: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
export const value = (card: Card) =>
  card.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank);
export function score(cards: Card[]) {
  let total = cards.reduce((sum, card) => sum + value(card), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}
export const natural = (cards: Card[]) => cards.length === 2 && score(cards).total === 21;
export function makeShoe(): Card[] {
  const cards = Array.from({ length: 6 }, (_, deck) =>
    (Object.keys(SUITS) as Suit[]).flatMap((suit) =>
      RANKS.map((rank) => ({ id: `${deck}-${suit}-${rank}`, rank, suit })),
    ),
  ).flat();
  const random = new Uint32Array(cards.length);
  crypto.getRandomValues(random);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor((random[i] / 4294967296) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function newGame(shoe = makeShoe()): Game {
  return {
    version: 1,
    phase: 'betting',
    balance: BANKROLL_REFILL,
    bet: 50,
    shoe,
    dealer: [],
    hands: [],
    active: 0,
    insuranceBet: 0,
    accuracy: null,
    stats: {
      refills: 0,
      rounds: 0,
      hands: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      blackjacks: 0,
      wagered: 0,
      net: 0,
      bestWin: 0,
      streak: 0,
      bestStreak: 0,
      surrenders: 0,
      insuranceWagered: 0,
      insuranceNet: 0,
      strategyDecisions: 0,
      strategyCorrectDecisions: 0,
      strategyHands: 0,
      strategyCorrectHands: 0,
    },
    history: [],
    message: 'A seat just for you.',
  };
}
export const canBet = (g: Game) => g.phase === 'betting' || g.phase === 'settled';
export const canRefill = (g: Game) => canBet(g) && g.balance < 10;
export const canSurrender = (g: Game) =>
  g.phase === 'player' &&
  g.hands.length === 1 &&
  !g.hands[0].split &&
  g.hands[0].cards.length === 2;
export const canDouble = (g: Game) =>
  g.phase === 'player' &&
  g.hands[g.active]?.cards.length === 2 &&
  g.balance >= g.hands[g.active].bet;
export const canSplit = (g: Game) =>
  g.phase === 'player' &&
  g.hands.length < MAX_HANDS &&
  g.hands[g.active]?.cards.length === 2 &&
  !g.hands[g.active].stood &&
  !(g.hands[g.active].split && g.hands[g.active].cards[0].rank === 'A') &&
  value(g.hands[g.active].cards[0]) === value(g.hands[g.active].cards[1]) &&
  g.balance >= g.hands[g.active].bet;
export function currentAdvice(game: Game) {
  if (game.phase === 'insurance')
    return {
      action: 'DECLINE_INSURANCE' as DecisionAction,
      name: 'Decline insurance',
      reason:
        'Basic strategy declines this side bet, even with a player blackjack. A 2:1 payout needs a blackjack probability above one third to be profitable.',
    };
  if (game.phase !== 'player') return null;
  const hand = game.hands[game.active];
  const points = score(hand.cards);
  const pair = hand.cards.length === 2 && value(hand.cards[0]) === value(hand.cards[1]);
  const advice = advise(
    pair ? 'pair' : points.soft ? 'soft' : 'hard',
    pair ? value(hand.cards[0]) : points.total,
    value(game.dealer[0]),
    {
      double: canDouble(game),
      split: canSplit(game),
      surrender: canSurrender(game),
    },
  );
  const actions: Record<Move, DecisionAction> = {
    H: 'HIT',
    S: 'STAND',
    Dh: 'DOUBLE',
    Ds: 'DOUBLE',
    P: 'SPLIT',
    Rh: 'SURRENDER',
  };
  return { ...advice, action: actions[advice.move] };
}
function recordDecision(g: Game, chosen: DecisionAction) {
  if (!g.accuracy) return; // Older unfinished rounds have no complete decision trail.
  const hand = g.hands[g.active];
  if (g.phase === 'insurance' && g.balance < hand.bet / 2) return; // No optional choice.
  const advice = currentAdvice(g);
  if (!advice) return;
  const points = score(hand.cards);
  const id = g.accuracy.decisions.length + 1;
  g.accuracy.decisions.push({
    id,
    hand: hand.split ? g.active + 1 : 0,
    source: g.phase === 'insurance' ? 'insurance' : hand.split ? 'split' : 'original',
    cards: hand.cards.map((c) => `${c.rank}${SUITS[c.suit]}`),
    total: points.total,
    soft: points.soft,
    upcard: `${g.dealer[0].rank}${SUITS[g.dealer[0].suit]}`,
    chosen,
    expected: advice.action,
    correct: chosen === advice.action,
    explanation: advice.reason,
    available: { double: canDouble(g), split: canSplit(g), surrender: canSurrender(g) },
  });
  hand.decisionIds = [...(hand.decisionIds ?? []), id];
}
function draw(g: Game) {
  const card = g.shoe.shift();
  if (!card) throw new Error('Shoe exhausted');
  return card;
}
function nextHand(g: Game) {
  g.hands[g.active].stood = true;
  const next = g.hands.findIndex((h, i) => i > g.active && !h.stood && score(h.cards).total < 21);
  if (next >= 0) {
    g.active = next;
    if (g.hands[next].cards.length === 1) return dealSplitCard(g);
    g.phase = 'player';
    g.message = `Your turn · hand ${next + 1}`;
  } else {
    g.phase = 'dealer';
    g.message = 'Dealer’s turn';
  }
  return g;
}
function dealSplitCard(g: Game) {
  const hand = g.hands[g.active];
  hand.cards.push(draw(g));
  hand.stood = hand.cards[0].rank === 'A';
  g.phase = 'split-dealing';
  g.message = hand.stood
    ? `Split aces · one card to hand ${g.active + 1}`
    : `Dealing to hand ${g.active + 1}…`;
  return g;
}
function settle(g: Game) {
  const dealerTotal = score(g.dealer).total;
  const dealerNatural = natural(g.dealer);
  // Hold the side-bet payout until settlement so bankroll and round net reconcile once.
  const insuranceReturn = dealerNatural ? g.insuranceBet * 3 : 0;
  const insuranceNet = insuranceReturn - g.insuranceBet;
  let returned = insuranceReturn;
  let wager = g.insuranceBet;
  for (const hand of g.hands) {
    const total = score(hand.cards).total;
    const blackjack = !hand.split && natural(hand.cards);
    hand.result =
      hand.result === 'surrender'
        ? 'surrender'
        : total > 21
          ? 'loss'
          : blackjack && dealerNatural
            ? 'push'
            : dealerNatural
              ? 'loss'
              : blackjack
                ? 'blackjack'
                : dealerTotal > 21 || total > dealerTotal
                  ? 'win'
                  : total === dealerTotal
                    ? 'push'
                    : 'loss';
    const payout =
      hand.result === 'surrender'
        ? hand.bet / 2
        : hand.result === 'blackjack'
          ? hand.bet * 2.5
          : hand.result === 'win'
            ? hand.bet * 2
            : hand.result === 'push'
              ? hand.bet
              : 0;
    returned += payout;
    wager += hand.bet;
    g.stats.hands++;
    if (hand.result === 'win' || hand.result === 'blackjack') {
      g.stats.wins++;
      g.stats.streak = Math.max(0, g.stats.streak) + 1;
    } else if (hand.result === 'loss' || hand.result === 'surrender') {
      g.stats.losses++;
      g.stats.streak = Math.min(0, g.stats.streak) - 1;
    } else {
      g.stats.pushes++;
      g.stats.streak = 0;
    }
    if (hand.result === 'blackjack') g.stats.blackjacks++;
    if (hand.result === 'surrender') g.stats.surrenders++;
    g.stats.bestStreak = Math.max(g.stats.bestStreak, g.stats.streak);
  }
  const net = returned - wager;
  g.balance += returned;
  g.stats.rounds++;
  g.stats.wagered += wager;
  g.stats.net += net;
  g.stats.bestWin = Math.max(g.stats.bestWin, net);
  g.stats.insuranceWagered += g.insuranceBet;
  g.stats.insuranceNet += insuranceNet;
  const accuracy: RoundAccuracy | null = g.accuracy
    ? {
        ...g.accuracy,
        hands: g.hands.map((hand) => gradeHand(hand.decisionIds ?? [], g.accuracy!.decisions)),
      }
    : null;
  if (accuracy) {
    const summary = accuracySummary(accuracy);
    g.stats.strategyDecisions += summary.decisions;
    g.stats.strategyCorrectDecisions += summary.correctDecisions;
    g.stats.strategyHands += summary.hands;
    g.stats.strategyCorrectHands += summary.correctHands;
  }
  g.history = [
    {
      id: g.stats.rounds,
      time: new Date().toISOString(),
      player: g.hands.map((h) => h.cards.map((c) => `${c.rank}${SUITS[c.suit]}`).join(' ')),
      dealer: dealerTotal,
      wager,
      net,
      balance: g.balance,
      results: g.hands.map((h) => h.result!),
      insuranceBet: g.insuranceBet,
      insuranceNet,
      accuracy,
    },
    ...g.history,
  ].slice(0, 100);
  g.phase = 'settled';
  g.message =
    g.hands[0].result === 'surrender'
      ? 'Surrendered. Half your wager returned.'
      : dealerNatural && g.insuranceBet > 0
        ? 'Dealer blackjack. Insurance pays 2:1.'
        : g.hands.length === 1 && g.hands[0].result === 'blackjack'
          ? 'Blackjack. Beautifully played.'
          : net > 0
            ? 'The table is yours.'
            : net === 0
              ? g.hands.every((hand) => hand.result === 'push')
                ? 'A push. All square.'
                : 'All square this round.'
              : g.hands.every((h) => score(h.cards).total > 21)
                ? 'Busted. A fresh hand awaits.'
                : 'This one goes to the house.';
  if (g.balance >= 10 && g.bet > g.balance) g.bet = Math.min(500, Math.floor(g.balance / 5) * 5);
  return g;
}
export function reducer(state: Game, action: Action): Game {
  if (action.type === 'RESET') return canBet(state) ? newGame() : state;
  if (action.type === 'REFILL') {
    if (!canRefill(state)) return state;
    return {
      ...state,
      phase: 'betting',
      balance: state.balance + BANKROLL_REFILL,
      dealer: [],
      hands: [],
      active: 0,
      insuranceBet: 0,
      accuracy: null,
      stats: { ...state.stats, refills: state.stats.refills + 1 },
      message: '2,500 credits added. Your stats continue.',
    };
  }
  if (action.type === 'BET') {
    if (!canBet(state) || !Number.isFinite(action.amount)) return state;
    return {
      ...state,
      bet: Math.max(
        10,
        Math.min(500, Math.floor(state.balance / 5) * 5, Math.round(action.amount / 5) * 5),
      ),
    };
  }
  if (action.type === 'DEAL') {
    if (!canBet(state) || state.balance < state.bet || state.bet < 10) return state;
    const g: Game = {
      ...state,
      balance: state.balance - state.bet,
      shoe: state.shoe.length < 80 ? makeShoe() : [...state.shoe],
      hands: [],
      dealer: [],
      active: 0,
      insuranceBet: 0,
      accuracy: { version: 1, decisions: [] },
      phase: 'dealing',
      message: 'A little anticipation…',
    };
    const first = draw(g);
    g.dealer.push(draw(g));
    const second = draw(g);
    g.dealer.push(draw(g));
    g.hands = [{ cards: [first, second], bet: g.bet, stood: false, split: false, decisionIds: [] }];
    return g;
  }
  const g: Game = {
    ...state,
    shoe: [...state.shoe],
    dealer: [...state.dealer],
    hands: state.hands.map((h) => ({ ...h, cards: [...h.cards] })),
    stats: { ...state.stats },
    accuracy: state.accuracy
      ? { ...state.accuracy, decisions: [...state.accuracy.decisions] }
      : null,
  };
  const h = g.hands[g.active];
  if (
    g.phase === 'insurance' &&
    (action.type === 'INSURE' || action.type === 'DECLINE_INSURANCE')
  ) {
    if (action.type === 'INSURE' && g.balance < h.bet / 2) return state;
    recordDecision(g, action.type);
    if (action.type === 'INSURE') {
      g.insuranceBet = h.bet / 2;
      g.balance -= g.insuranceBet;
    }
    g.phase = 'peeking';
    g.message = 'Checking for blackjack…';
    return g;
  }
  if (action.type === 'READY') {
    if (g.phase === 'dealing') {
      if (g.dealer[0].rank === 'A') {
        g.phase = 'insurance';
        g.message = 'Dealer shows an Ace. Insurance?';
        return g;
      }
      if (value(g.dealer[0]) === 10) {
        g.phase = 'peeking';
        g.message = 'Checking for blackjack…';
        return g;
      }
      if (natural(h.cards)) return settle(g);
      g.phase = 'player';
      g.message = 'Your move. Trust your hand.';
      return g;
    }
    if (g.phase === 'peeking') {
      if (natural(g.dealer) || natural(h.cards)) return settle(g);
      g.phase = 'player';
      g.message = g.insuranceBet
        ? 'No blackjack. Insurance lost. Your move.'
        : 'No blackjack. Your move.';
      return g;
    }
    if (g.phase === 'splitting' && h.cards.length === 1) return dealSplitCard(g);
    if (['hitting', 'splitting', 'split-dealing'].includes(g.phase)) {
      if (h.stood || score(h.cards).total >= 21) return nextHand(g);
      g.phase = 'player';
      g.message =
        g.hands.length > 1 ? `Your turn · hand ${g.active + 1}` : 'Your move. Trust your hand.';
      return g;
    }
    return state;
  }
  if (action.type === 'DEALER_TICK') {
    if (g.phase !== 'dealer') return state;
    if (g.hands.some((hand) => score(hand.cards).total <= 21) && score(g.dealer).total < 17) {
      g.dealer.push(draw(g));
      return g;
    }
    return settle(g);
  }
  if (g.phase !== 'player' || !h) return state;
  if (action.type === 'SURRENDER' && canSurrender(g)) {
    recordDecision(g, action.type);
    h.result = 'surrender';
    h.stood = true;
    return settle(g);
  }
  if (action.type === 'STAND') {
    recordDecision(g, action.type);
    h.stood = true;
    return nextHand(g);
  }
  if (action.type === 'HIT') {
    recordDecision(g, action.type);
    h.cards.push(draw(g));
    g.phase = 'hitting';
    return g;
  }
  if (action.type === 'DOUBLE' && canDouble(g)) {
    recordDecision(g, action.type);
    g.balance -= h.bet;
    h.bet *= 2;
    h.cards.push(draw(g));
    h.stood = true;
    g.phase = 'hitting';
    return g;
  }
  if (action.type === 'SPLIT' && canSplit(g)) {
    recordDecision(g, action.type);
    g.balance -= h.bet;
    const children = h.cards.map((card) => ({
      cards: [card],
      bet: h.bet,
      stood: false,
      split: true,
      decisionIds: [...(h.decisionIds ?? [])],
    }));
    // Replace only the active hand, leaving completed and waiting hands in table order.
    g.hands.splice(g.active, 1, ...children);
    g.phase = 'splitting';
    g.message = 'Separating your pair…';
    return g;
  }
  return state;
}
export const SAVE_KEY = 'noir-club.game.v1';
export function loadGame(): Game {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as Game | null;
    const isCard = (c: Card) =>
      !!c && RANKS.includes(c.rank) && c.suit in SUITS && typeof c.id === 'string';
    if (
      raw?.version === 1 &&
      Number.isFinite(raw.balance) &&
      raw.balance >= 0 &&
      Number.isFinite(raw.bet) &&
      raw.bet >= 10 &&
      raw.bet <= 500 &&
      [
        'betting',
        'dealing',
        'insurance',
        'peeking',
        'player',
        'hitting',
        'splitting',
        'split-dealing',
        'dealer',
        'settled',
      ].includes(raw.phase) &&
      Array.isArray(raw.shoe) &&
      raw.shoe.every(isCard) &&
      Array.isArray(raw.dealer) &&
      raw.dealer.every(isCard) &&
      Array.isArray(raw.hands) &&
      raw.hands.length <= MAX_HANDS &&
      raw.hands.every(
        (h, i) =>
          Array.isArray(h.cards) &&
          (h.cards.length >= 2 ||
            (h.cards.length === 1 &&
              h.split &&
              !h.stood &&
              raw.hands.length >= 2 &&
              (raw.phase === 'splitting' ||
                (i > raw.active && ['split-dealing', 'player', 'hitting'].includes(raw.phase))))) &&
          h.cards.every(isCard) &&
          Number.isFinite(h.bet),
      ) &&
      (canBet(raw) || !!raw.hands[raw.active]) &&
      raw.stats &&
      Object.values(raw.stats).every(Number.isFinite) &&
      Array.isArray(raw.history) &&
      raw.history.every(
        (r) =>
          Array.isArray(r.player) &&
          r.player.every((p) => typeof p === 'string') &&
          Array.isArray(r.results) &&
          Number.isFinite(r.balance) &&
          Number.isFinite(r.net),
      )
    ) {
      if (
        raw.insuranceBet !== undefined &&
        (!Number.isFinite(raw.insuranceBet) || raw.insuranceBet < 0)
      )
        return newGame();
      // Upgrade existing v1 sessions without losing balances or hand history.
      const accuracy =
        isDecisionAudit(raw.accuracy) &&
        raw.hands.every((h) => validDecisionIds(h.decisionIds, raw.accuracy!))
          ? raw.accuracy
          : null;
      return {
        ...raw,
        accuracy,
        insuranceBet: raw.insuranceBet ?? 0,
        stats: {
          ...raw.stats,
          refills:
            Number.isSafeInteger(raw.stats.refills) && raw.stats.refills >= 0
              ? raw.stats.refills
              : 0,
          surrenders: raw.stats.surrenders ?? 0,
          insuranceWagered: raw.stats.insuranceWagered ?? 0,
          insuranceNet: raw.stats.insuranceNet ?? 0,
          strategyDecisions: raw.stats.strategyDecisions ?? 0,
          strategyCorrectDecisions: raw.stats.strategyCorrectDecisions ?? 0,
          strategyHands: raw.stats.strategyHands ?? 0,
          strategyCorrectHands: raw.stats.strategyCorrectHands ?? 0,
        },
        history: raw.history.map((round) => ({
          ...round,
          insuranceBet: round.insuranceBet ?? 0,
          insuranceNet: round.insuranceNet ?? 0,
          accuracy: isRoundAccuracy(round.accuracy, round.player.length) ? round.accuracy : null,
        })),
        // A completed round belongs in the tracker, not on a newly opened table.
        ...(raw.phase === 'settled'
          ? {
              phase: 'betting' as const,
              dealer: [],
              hands: [],
              insuranceBet: 0,
              accuracy: null,
              message: 'Welcome back. Your seat awaits.',
            }
          : {}),
      };
    }
  } catch {
    /* Unavailable or corrupted local storage starts a playable session. */
  }
  return newGame();
}
export const credits = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${credits(Math.abs(n))}`;
