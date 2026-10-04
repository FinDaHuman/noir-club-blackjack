import { useEffect, useRef } from 'react';
import { ArrowDownToLine, ArrowRight, RotateCcw, X } from 'lucide-react';
import { canBet, credits, signed, type Game } from '../game';

export function Sparkline({ game, large = false }: { game: Game; large?: boolean }) {
  const values = [...game.history].reverse().map((r) => r.balance);
  values.unshift(
    game.history.length === 100 ? values[0] - game.history[game.history.length - 1].net : 2500,
  );
  if (values.length === 1) values.push(values[0]);
  const min = Math.min(...values) - 30;
  const max = Math.max(...values) + 30;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 300},${85 - ((v - min) / (max - min)) * 70}`)
    .join(' ');
  return (
    <svg
      className={`sparkline ${large ? 'large' : ''}`}
      viewBox="0 0 300 100"
      role="img"
      aria-label={`Bankroll trend, current balance ${credits(game.balance)} credits`}
    >
      <path d="M0 90H300" className="chart-baseline" />
      <polyline points={points} />
    </svg>
  );
}
export function Session({ game, open }: { game: Game; open: () => void }) {
  const { stats } = game;
  return (
    <aside className="session">
      <h2>Your session</h2>
      <dl>
        <div>
          <dt>Hands played</dt>
          <dd>{stats.hands}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{stats.hands ? `${Math.round((stats.wins / stats.hands) * 100)}%` : '—'}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd className={stats.net < 0 ? 'negative' : 'positive'}>{signed(stats.net)}</dd>
        </div>
      </dl>
      <Sparkline game={game} />
      <button className="text-button" onClick={open}>
        View tracker <ArrowRight size={16} />
      </button>
    </aside>
  );
}
export function Dialog({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close} autoFocus>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function exportHistory(game: Game) {
  const csv = [
    'Round,Time,Player,Dealer,Wager,Net,Balance,Results,Insurance bet,Insurance net',
    ...game.history.map((r) =>
      [
        r.id,
        r.time,
        `"${r.player.join(' / ')}"`,
        r.dealer,
        r.wager,
        r.net,
        r.balance,
        r.results.join(' / '),
        r.insuranceBet,
        r.insuranceNet,
      ].join(','),
    ),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'noir-club-history.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Tracker({
  game,
  close,
  reset,
}: {
  game: Game;
  close: () => void;
  reset: () => void;
}) {
  const s = game.stats;
  return (
    <Dialog title="Your time at the table" close={close} wide>
      <p className="dialog-intro">
        Every hand tells a story. Your session is saved on this device.
      </p>
      <div className="tracker-hero">
        <div>
          <span className="eyeline">Bankroll</span>
          <strong>
            {credits(game.balance)} <small>credits</small>
          </strong>
        </div>
        <div>
          <span className="eyeline">Net result</span>
          <strong className={s.net < 0 ? 'negative' : 'positive'}>{signed(s.net)}</strong>
        </div>
      </div>
      <Sparkline game={game} large />
      <div className="tracker-grid">
        {[
          ['Hands played', s.hands],
          ['Win rate', s.hands ? `${Math.round((s.wins / s.hands) * 100)}%` : '—'],
          ['Wins / losses / pushes', `${s.wins} / ${s.losses} / ${s.pushes}`],
          ['Blackjacks', s.blackjacks],
          ['Surrenders (included in losses)', s.surrenders],
          ['Insurance wagered / net', `${credits(s.insuranceWagered)} / ${signed(s.insuranceNet)}`],
          ['Best win', signed(s.bestWin)],
          ['Best win streak', s.bestStreak],
          ['Total wagered', credits(s.wagered)],
          [
            'Current streak',
            s.streak === 0
              ? '—'
              : `${Math.abs(s.streak)} ${s.streak > 0 ? (s.streak === 1 ? 'win' : 'wins') : s.streak === -1 ? 'loss' : 'losses'}`,
          ],
        ].map(([label, val]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{val}</b>
          </div>
        ))}
      </div>
      <div className="history-heading">
        <h3>
          Hand history <span>Last 100 rounds</span>
        </h3>
        <button
          className="text-button"
          disabled={!game.history.length}
          onClick={() => exportHistory(game)}
        >
          <ArrowDownToLine size={16} /> Export CSV
        </button>
      </div>
      {game.history.length ? (
        <div className="history-scroll">
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Your cards</th>
                <th>Dealer</th>
                <th>Result</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {game.history.map((r) => (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>
                    {r.player.map((p, i) => (
                      <div key={i}>{p}</div>
                    ))}
                  </td>
                  <td>{r.dealer > 21 ? 'Bust' : r.dealer}</td>
                  <td>
                    {r.results.join(' / ')}
                    {r.insuranceBet > 0 && (
                      <small className="insurance-result">Insurance {signed(r.insuranceNet)}</small>
                    )}
                  </td>
                  <td className={r.net < 0 ? 'negative' : 'positive'}>{signed(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-history">
          <span>♤</span>
          <p>Your first chapter is still to come.</p>
          <small>Deal a hand to start your tracker.</small>
        </div>
      )}
      <div className="tracker-footer">
        <span>Virtual credits · no real-money wagering</span>
        <button className="text-button" disabled={!canBet(game)} onClick={reset}>
          <RotateCcw size={15} /> Reset session
        </button>
      </div>
    </Dialog>
  );
}
export function Rules({ close }: { close: () => void }) {
  return (
    <Dialog title="The house rules" close={close}>
      <p className="dialog-intro">A classic game. A few things to know before you settle in.</p>
      <ol className="rules-list">
        <li>
          <b>Get closer to 21.</b>
          <p>Beat the dealer without going over. Face cards count as 10; aces count as 1 or 11.</p>
        </li>
        <li>
          <b>Blackjack pays 3:2.</b>
          <p>
            An ace and a ten-value card on your first two cards is blackjack. Other wins pay 1:1.
            Equal totals push and return your wager.
          </p>
        </li>
        <li>
          <b>The dealer stands on all 17s.</b>
          <p>
            Six decks. The dealer checks for blackjack before your turn. The shoe reshuffles between
            rounds when fewer than 80 cards remain.
          </p>
        </li>
        <li>
          <b>Make your move.</b>
          <p>
            Hit to take a card, or stand. Double any two-card hand for one final card. Split a
            same-rank pair into two equal wagers, once per round. You may double after splitting.
            Split aces receive one card each; a split 21 pays 1:1.
          </p>
        </li>
        <li>
          <b>Insurance & late surrender.</b>
          <p>
            Against an Ace, accept or decline a half-bet insurance wager before the dealer peeks.
            Insurance pays 2:1 on dealer blackjack. Against an Ace or a ten-value card, the dealer
            visibly checks the hole card. Once blackjack is ruled out, you may surrender your
            original two-card hand for half your wager back. No surrender after hitting, doubling or
            splitting.
          </p>
        </li>
        <li>
          <b>Your table, your pace.</b>
          <p>
            Wagers: 10–500 virtual credits in steps of 5. No purchases or cash-out. Reset your
            session in the tracker for a fresh 2,500 credits.
          </p>
        </li>
      </ol>
      <div className="shortcuts">
        <span>Keyboard</span>
        <kbd>Space</kbd> Deal <kbd>H</kbd> Hit <kbd>S</kbd> Stand <kbd>D</kbd> Double <kbd>P</kbd>{' '}
        Split <kbd>R</kbd> Surrender
      </div>
      <p className="rules-note">
        Music and effects begin with your first interaction. Control each separately at the top of
        the table.
      </p>
    </Dialog>
  );
}
