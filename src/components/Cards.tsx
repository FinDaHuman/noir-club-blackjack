import { useEffect, useRef, useState } from 'react';
import { Crown } from 'lucide-react';
import { SUITS, score, type Card, type Hand as HandType } from '../game';

const positions: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [50, 20],
    [50, 80],
  ],
  3: [
    [50, 18],
    [50, 50],
    [50, 82],
  ],
  4: [
    [25, 20],
    [75, 20],
    [25, 80],
    [75, 80],
  ],
  5: [
    [25, 20],
    [75, 20],
    [50, 50],
    [25, 80],
    [75, 80],
  ],
  6: [
    [25, 18],
    [75, 18],
    [25, 50],
    [75, 50],
    [25, 82],
    [75, 82],
  ],
  7: [
    [25, 18],
    [75, 18],
    [50, 34],
    [25, 50],
    [75, 50],
    [25, 82],
    [75, 82],
  ],
  8: [
    [25, 18],
    [75, 18],
    [50, 34],
    [25, 50],
    [75, 50],
    [50, 67],
    [25, 82],
    [75, 82],
  ],
  9: [
    [25, 14],
    [75, 14],
    [25, 38],
    [75, 38],
    [50, 50],
    [25, 62],
    [75, 62],
    [25, 86],
    [75, 86],
  ],
  10: [
    [25, 14],
    [75, 14],
    [50, 27],
    [25, 38],
    [75, 38],
    [25, 62],
    [75, 62],
    [50, 73],
    [25, 86],
    [75, 86],
  ],
};
function Face({ card }: { card: Card }) {
  const suit = SUITS[card.suit];
  const number = card.rank === 'A' ? 1 : Number(card.rank);
  return (
    <div className={`card-face ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : ''}`}>
      <div className="card-corner">
        <b>{card.rank}</b>
        <span>{suit}</span>
      </div>
      <div className="card-corner bottom">
        <b>{card.rank}</b>
        <span>{suit}</span>
      </div>
      {positions[number] ? (
        <div className={`pips ${number === 1 ? 'ace' : ''}`}>
          {positions[number].map(([x, y], i) => (
            <span
              key={i}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: `translate(-50%, -50%) ${y > 50 ? 'rotate(180deg)' : ''}`,
              }}
            >
              {suit}
            </span>
          ))}
        </div>
      ) : (
        <div className="court">
          <Crown strokeWidth={1.2} />
          <span>{card.rank}</span>
          <b>{suit}</b>
          <Crown className="inverted" strokeWidth={1.2} />
        </div>
      )}
      {number === 1 && <span className="ace-signature">NOIR CLUB</span>}
    </div>
  );
}
export function PlayingCard({
  card,
  hidden,
  delay = 0,
  animate = true,
  peeking = false,
}: {
  card: Card;
  hidden?: boolean;
  delay?: number;
  animate?: boolean;
  peeking?: boolean;
}) {
  const [showBack, setShowBack] = useState(Boolean(hidden));
  const [flipping, setFlipping] = useState(false);
  const previousHidden = useRef(Boolean(hidden));
  useEffect(() => {
    const nextHidden = Boolean(hidden);
    if (nextHidden === previousHidden.current) return;
    previousHidden.current = nextHidden;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShowBack(nextHidden);
      return;
    }
    setFlipping(true);
    const midpoint = setTimeout(() => setShowBack(nextHidden), 260);
    const end = setTimeout(() => setFlipping(false), 520);
    return () => {
      clearTimeout(midpoint);
      clearTimeout(end);
    };
  }, [hidden]);
  return (
    <div
      className={`playing-card ${animate ? 'arriving' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      role="img"
      aria-label={hidden ? 'Face-down card' : `${card.rank} of ${card.suit}`}
    >
      <div
        className={`card-flipper ${flipping ? 'is-flipping' : ''} ${peeking ? 'is-peeking' : ''}`}
      >
        {showBack ? <div className="card-back" /> : <Face card={card} />}
      </div>
    </div>
  );
}
export function Hand({
  cards,
  label,
  hidden = false,
  active = false,
  result,
  dealing = false,
  dealer = false,
  preview = false,
  peeking = false,
  waiting = false,
  oneCardOnly = false,
}: {
  cards: Card[];
  label: string;
  hidden?: boolean;
  active?: boolean;
  result?: HandType['result'];
  dealing?: boolean;
  dealer?: boolean;
  preview?: boolean;
  peeking?: boolean;
  waiting?: boolean;
  oneCardOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const total = score(hidden ? cards.slice(0, 1) : cards);
  return (
    <section
      className={`hand ${dealer ? 'dealer-hand' : 'player-hand'} ${active ? 'active' : ''} ${preview ? 'preview-hand' : ''}`}
      aria-label={label}
      ref={ref}
    >
      {dealer && (
        <div className="hand-label">
          <span>{label}</span>
          <b className="score">
            {total.total || '—'}
            {hidden && cards.length > 0 ? ' + ?' : ''}
          </b>
        </div>
      )}
      <div
        className="card-fan"
        style={{ '--hand-width': `${width}px`, '--count': cards.length } as React.CSSProperties}
      >
        {cards.map((card, i) => (
          <div
            className="card-position"
            key={card.id}
            style={
              {
                '--index': i,
                '--rotation': `${cards.length <= 4 ? (i - (cards.length - 1) / 2) * (dealer ? 3 : 6) : 0}deg`,
              } as React.CSSProperties
            }
          >
            <PlayingCard
              card={card}
              hidden={hidden && i === 1}
              peeking={peeking && i === 1}
              delay={dealing ? (i * 2 + (dealer ? 1 : 0)) * 200 : 0}
              animate={!preview}
            />
          </div>
        ))}
      </div>
      {!dealer && (
        <div className="hand-label">
          <span>
            {label}
            {active && <i />}
          </span>
          <b className={`score ${total.total > 21 ? 'busted' : ''}`}>
            {waiting ? '—' : total.total || '—'}
            {!waiting && total.soft && total.total <= 21 && !preview && <small> soft</small>}
          </b>
        </div>
      )}
      {!dealer && (
        <div className="hand-status">
          {result ? (
            <em className={`hand-result ${result}`}>
              {result === 'blackjack'
                ? 'BLACKJACK'
                : result === 'loss' && total.total > 21
                  ? 'BUST'
                  : result.toUpperCase()}
            </em>
          ) : waiting ? (
            <span>Waiting for card</span>
          ) : oneCardOnly ? (
            <span>One card only</span>
          ) : null}
        </div>
      )}
    </section>
  );
}
