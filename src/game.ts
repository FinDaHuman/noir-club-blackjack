export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Card = { id: string; rank: string; suit: Suit };
export type Result = 'blackjack' | 'win' | 'loss' | 'push';
export type Hand = { cards: Card[]; bet: number; stood: boolean; split: boolean; result?: Result };
export type Round = {
  id: number;
  time: string;
  player: string[];
  dealer: number;
  wager: number;
  net: number;
  balance: number;
  results: Result[];
};
export type Stats = {
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
};
export type Game = {
  version: 1;
  phase: 'betting' | 'dealing' | 'player' | 'hitting' | 'splitting' | 'dealer' | 'settled';
  balance: number;
  bet: number;
  shoe: Card[];
  dealer: Card[];
  hands: Hand[];
  active: number;
  stats: Stats;
  history: Round[];
  message: string;
};
export type Action =
  | { type: 'BET'; amount: number }
  | { type: 'DEAL' | 'READY' | 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'DEALER_TICK' | 'RESET' };

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
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
    balance: 2500,
    bet: 50,
    shoe,
    dealer: [],
    hands: [],
    active: 0,
    stats: {
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
    },
    history: [],
    message: 'A seat just for you.',
  };
}
export const canBet = (g: Game) => g.phase === 'betting' || g.phase === 'settled';
export const canDouble = (g: Game) =>
  g.phase === 'player' &&
  g.hands[g.active]?.cards.length === 2 &&
  g.balance >= g.hands[g.active].bet;
export const canSplit = (g: Game) =>
  g.phase === 'player' &&
  g.hands.length === 1 &&
  g.hands[0].cards.length === 2 &&
  g.hands[0].cards[0].rank === g.hands[0].cards[1].rank &&
  g.balance >= g.hands[0].bet;
function draw(g: Game) {
  const card = g.shoe.shift();
  if (!card) throw new Error('Shoe exhausted');
  return card;
}
function nextHand(g: Game) {
  const next = g.hands.findIndex((h, i) => i > g.active && !h.stood && score(h.cards).total < 21);
  if (next >= 0) {
    g.active = next;
    g.phase = 'player';
    g.message = `Your turn · hand ${next + 1}`;
  } else {
    g.phase = 'dealer';
    g.message = 'Dealer’s turn';
  }
  return g;
}
function settle(g: Game) {
  const dealerTotal = score(g.dealer).total;
  const dealerNatural = natural(g.dealer);
  let returned = 0;
  let wager = 0;
  for (const hand of g.hands) {
    const total = score(hand.cards).total;
    const blackjack = !hand.split && natural(hand.cards);
    hand.result =
      total > 21
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
      hand.result === 'blackjack'
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
    } else if (hand.result === 'loss') {
      g.stats.losses++;
      g.stats.streak = Math.min(0, g.stats.streak) - 1;
    } else {
      g.stats.pushes++;
      g.stats.streak = 0;
    }
    if (hand.result === 'blackjack') g.stats.blackjacks++;
    g.stats.bestStreak = Math.max(g.stats.bestStreak, g.stats.streak);
  }
  const net = returned - wager;
  g.balance += returned;
  g.stats.rounds++;
  g.stats.wagered += wager;
  g.stats.net += net;
  g.stats.bestWin = Math.max(g.stats.bestWin, net);
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
    },
    ...g.history,
  ].slice(0, 100);
  g.phase = 'settled';
  g.message =
    g.hands.length === 1 && g.hands[0].result === 'blackjack'
      ? 'Blackjack. Beautifully played.'
      : net > 0
        ? 'The table is yours.'
        : net === 0
          ? 'A push. All square.'
          : g.hands.every((h) => score(h.cards).total > 21)
            ? 'Busted. A fresh hand awaits.'
            : 'This one goes to the house.';
  if (g.balance >= 10 && g.bet > g.balance) g.bet = Math.min(500, Math.floor(g.balance / 5) * 5);
  return g;
}
export function reducer(state: Game, action: Action): Game {
  if (action.type === 'RESET') return canBet(state) ? newGame() : state;
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
      phase: 'dealing',
      message: 'A little anticipation…',
    };
    const first = draw(g);
    g.dealer.push(draw(g));
    const second = draw(g);
    g.dealer.push(draw(g));
    g.hands = [{ cards: [first, second], bet: g.bet, stood: false, split: false }];
    return g;
  }
  const g: Game = {
    ...state,
    shoe: [...state.shoe],
    dealer: [...state.dealer],
    hands: state.hands.map((h) => ({ ...h, cards: [...h.cards] })),
    stats: { ...state.stats },
  };
  const h = g.hands[g.active];
  if (action.type === 'READY') {
    if (g.phase === 'dealing') {
      if (natural(g.dealer) || natural(h.cards)) return settle(g);
      g.phase = 'player';
      g.message = 'Your move. Trust your hand.';
      return g;
    }
    if (g.phase === 'hitting' || g.phase === 'splitting') {
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
  if (action.type === 'STAND') {
    h.stood = true;
    return nextHand(g);
  }
  if (action.type === 'HIT') {
    h.cards.push(draw(g));
    g.phase = 'hitting';
    return g;
  }
  if (action.type === 'DOUBLE' && canDouble(g)) {
    g.balance -= h.bet;
    h.bet *= 2;
    h.cards.push(draw(g));
    h.stood = true;
    g.phase = 'hitting';
    return g;
  }
  if (action.type === 'SPLIT' && canSplit(g)) {
    g.balance -= h.bet;
    const aces = h.cards[0].rank === 'A';
    g.hands = h.cards.map((card) => ({
      cards: [card, draw(g)],
      bet: h.bet,
      stood: aces,
      split: true,
    }));
    g.phase = 'splitting';
    g.message = aces ? 'Split aces receive one card each.' : 'Two hands. Two possibilities.';
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
      ['betting', 'dealing', 'player', 'hitting', 'splitting', 'dealer', 'settled'].includes(
        raw.phase,
      ) &&
      Array.isArray(raw.shoe) &&
      raw.shoe.every(isCard) &&
      Array.isArray(raw.dealer) &&
      raw.dealer.every(isCard) &&
      Array.isArray(raw.hands) &&
      raw.hands.length <= 2 &&
      raw.hands.every(
        (h) => h.cards.length >= 2 && h.cards.every(isCard) && Number.isFinite(h.bet),
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
    )
      return raw;
  } catch {
    /* Unavailable or corrupted local storage starts a playable session. */
  }
  return newGame();
}
export const credits = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${credits(Math.abs(n))}`;
