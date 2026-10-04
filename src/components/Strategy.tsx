import { useState } from 'react';
import { BookOpen, ArrowUpRight } from 'lucide-react';
import { currentAdvice, type Game } from '../game';
import { advise, cardName, chartMove, DEALER_CARDS, MOVE_NAMES, type HandKind } from '../strategy';
import { Dialog } from './Tracker';

const kinds: { kind: HandKind; title: string; note: string; values: number[] }[] = [
  {
    kind: 'hard',
    title: 'Hard totals',
    note: 'No Ace counted as 11. Check pairs first.',
    values: Array.from({ length: 18 }, (_, i) => i + 4),
  },
  {
    kind: 'soft',
    title: 'Soft totals',
    note: 'An Ace counted as 11. Soft 18 can still need a hit.',
    values: Array.from({ length: 10 }, (_, i) => i + 12),
  },
  {
    kind: 'pair',
    title: 'Pairs',
    note: 'Two cards of the same rank. Read this table before the totals.',
    values: Array.from({ length: 10 }, (_, i) => i + 2),
  },
];
function handName(kind: HandKind, n: number) {
  return kind === 'pair'
    ? `${cardName(n)}, ${cardName(n)}`
    : kind === 'soft'
      ? `${n} (A + ${n === 12 ? 'A' : n - 11})`
      : String(n);
}
export function Strategy({ game, close }: { game: Game; close: () => void }) {
  const [kind, setKind] = useState<HandKind>('hard');
  const [total, setTotal] = useState(16);
  const [dealer, setDealer] = useState(10);
  const [stage, setStage] = useState<'original' | 'split' | 'hit'>('original');
  const [funds, setFunds] = useState(true);
  const selected = kinds.find((k) => k.kind === kind)!;
  const advice = advise(kind, total, dealer, {
    double: funds && stage !== 'hit',
    split: funds && stage === 'original',
    surrender: stage === 'original',
  });
  const live = currentAdvice(game);
  const rows = kind === 'hard' ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] : selected.values;
  const selectedRow = kind === 'hard' ? Math.min(17, Math.max(8, total)) : total;
  return (
    <Dialog title="The strategy room" close={close} wide>
      <div className="strategy-intro">
        <BookOpen size={25} />
        <div>
          <span className="eyeline">Learn the next move</span>
          <p>Six decks · dealer stands on soft 17 · double after split · late surrender</p>
        </div>
      </div>
      {live && (
        <section className="live-advice" aria-label="Advice for your current hand">
          <span className="eyeline">Your current hand</span>
          <h3>{live.name}</h3>
          <p>{live.reason}</p>
        </section>
      )}
      <p className="strategy-explainer">
        Basic strategy chooses the strongest average play from your hand and the dealer’s visible
        card. It does not predict the next card. Start with a pair, then a soft total, otherwise a
        hard total.
      </p>
      <section className="strategy-finder" aria-labelledby="finder-title">
        <h3 id="finder-title">Explore a situation</h3>
        <div className="strategy-tabs" aria-label="Hand category">
          {kinds.map((k) => (
            <button
              key={k.kind}
              aria-pressed={kind === k.kind}
              onClick={() => {
                setKind(k.kind);
                if (k.kind === 'pair' && stage === 'hit') setStage('original');
                setTotal(k.kind === 'pair' ? 8 : k.kind === 'soft' ? 18 : 16);
              }}
            >
              {k.title}
            </button>
          ))}
        </div>
        <p className="strategy-note">{selected.note}</p>
        <div className="strategy-inputs">
          <label>
            Your hand
            <select value={total} onChange={(e) => setTotal(Number(e.target.value))}>
              {selected.values.map((n) => (
                <option key={n} value={n}>
                  {handName(kind, n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dealer upcard
            <select value={dealer} onChange={(e) => setDealer(Number(e.target.value))}>
              {DEALER_CARDS.map((n) => (
                <option key={n} value={n}>
                  {n === 10 ? '10 / J / Q / K' : cardName(n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hand stage
            <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
              <option value="original">Original two cards</option>
              <option value="split">Two cards after a split</option>
              {kind !== 'pair' && <option value="hit">After a hit (3+ cards)</option>}
            </select>
          </label>
        </div>
        <div className="strategy-options">
          <label>
            <input type="checkbox" checked={funds} onChange={(e) => setFunds(e.target.checked)} />{' '}
            Credits for double / split
          </label>
        </div>
        <p className="strategy-note">
          Doubling needs two cards and an extra wager. Surrender and splitting require your original
          two cards. Split aces are automatically finished after one extra card.
        </p>
        <div className={`strategy-answer move-${advice.move}`} role="status">
          <span className="eyeline">Recommended play</span>
          <h3>{advice.name}</h3>
          <p>{advice.reason}</p>
        </div>
      </section>
      <section className="strategy-chart" aria-label={`${selected.title} strategy chart`}>
        <h3>
          {selected.title} <span>Dealer upcard →</span>
        </h3>
        <p className="strategy-note">
          Select any cell to explore it. The chart shows original-hand choices; the adviser above
          applies your selected restrictions. Swipe the table sideways on small screens.
        </p>
        <div
          className="strategy-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable strategy table"
        >
          <table>
            <caption>{selected.title} · six decks, S17, DAS, late surrender</caption>
            <thead>
              <tr>
                <th scope="col">You ↓</th>
                {DEALER_CARDS.map((n) => (
                  <th scope="col" key={n}>
                    {cardName(n)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n}>
                  <th scope="row">
                    {kind === 'hard' && n === 8
                      ? '4–8'
                      : kind === 'hard' && n === 17
                        ? '17–21'
                        : handName(kind, n)}
                  </th>
                  {DEALER_CARDS.map((d) => {
                    const move = chartMove(kind, n, d);
                    return (
                      <td key={d}>
                        <button
                          className={`strategy-cell move-${move} ${selectedRow === n && dealer === d ? 'selected-cell' : ''}`}
                          aria-label={`${kind} ${handName(kind, n)} versus ${cardName(d)}: ${MOVE_NAMES[move]}`}
                          aria-pressed={selectedRow === n && dealer === d}
                          onClick={() => {
                            setTotal(n);
                            setDealer(d);
                          }}
                        >
                          {move}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="strategy-legend">
          {Object.entries(MOVE_NAMES).map(([code, name]) => (
            <span key={code}>
              <b className={`move-${code}`}>{code}</b>
              {name}
            </span>
          ))}
        </div>
      </section>
      <div className="strategy-lessons">
        <section>
          <h3>Know when to surrender</h3>
          <p>
            For this S17 table: hard 15 against 10, and hard 16 against 9, 10 or Ace. Split 8,8
            instead when available. Surrender is only offered on your original two cards after the
            blackjack check.
          </p>
        </section>
        <section>
          <h3>Insurance is a separate bet</h3>
          <p>
            Only offered against an Ace, before the peek. It costs half your original bet and pays
            2:1 if the dealer has blackjack. Basic strategy declines it, including when you hold
            blackjack.
          </p>
        </section>
        <section>
          <h3>After a split</h3>
          <p>
            This table allows one split into two hands. No resplitting. Use the hard or soft table
            for the next decision. You may double a two-card split hand; split aces receive only one
            card each.
          </p>
        </section>
      </div>
      <p className="strategy-source">
        Reference:{' '}
        <a
          href="https://wizardofodds.com/games/blackjack/strategy/calculator/"
          target="_blank"
          rel="noreferrer"
        >
          Wizard of Odds basic strategy <ArrowUpRight size={13} />
        </a>
        . Total-dependent guidance; it does not track the remaining shoe or apply card-composition
        exceptions. Winning a particular hand is never guaranteed.
      </p>
    </Dialog>
  );
}
