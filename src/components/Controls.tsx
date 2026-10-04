import { useEffect, useState } from 'react';
import { Coins, Minus, Plus, RotateCcw, ArrowUpRight } from 'lucide-react';
import { canBet, canDouble, canSplit, credits, type Action, type Game } from '../game';
export function Controls({
  game,
  act,
  reset,
}: {
  game: Game;
  act: (action: Action) => void;
  reset: () => void;
}) {
  const betting = canBet(game);
  const playing = game.phase === 'player';
  const broke = game.balance < 10 && betting;
  const [draft, setDraft] = useState(String(game.bet));
  useEffect(() => {
    setDraft(String(game.bet));
  }, [game.bet, game.phase]);
  const commitBet = () => {
    act({ type: 'BET', amount: Number(draft) });
    setDraft(
      String(
        Math.max(
          10,
          Math.min(500, Math.floor(game.balance / 5) * 5, Math.round(Number(draft) / 5) * 5),
        ),
      ),
    );
  };
  return (
    <footer className="control-deck">
      <div className="bankroll">
        <span className="eyeline">Bankroll</span>
        <div>
          <Coins size={24} strokeWidth={1.35} />
          <strong>{credits(game.balance)}</strong>
        </div>
        <small>VIRTUAL CREDITS</small>
      </div>
      <div className="bet-controls">
        <label className="eyeline" htmlFor="wager">
          {betting ? 'Bet amount' : 'On the table'}
        </label>
        <div className="bet-input">
          <button
            className="adjust"
            aria-label="Decrease bet"
            disabled={!betting || game.bet <= 10}
            onClick={() => act({ type: 'BET', amount: game.bet - 5 })}
          >
            <Minus size={16} />
          </button>
          <input
            id="wager"
            aria-label="Bet amount"
            inputMode="numeric"
            type="number"
            min="10"
            max={Math.min(500, game.balance)}
            step="5"
            value={betting ? draft : game.hands.reduce((s, h) => s + h.bet, 0)}
            disabled={!betting}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitBet}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <button
            className="adjust"
            aria-label="Increase bet"
            disabled={!betting || game.bet + 5 > Math.min(game.balance, 500)}
            onClick={() => act({ type: 'BET', amount: game.bet + 5 })}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="chips" aria-label="Choose your bet">
        {[10, 25, 50, 100, 500].map((n) => (
          <button
            key={n}
            className={`chip chip-${n} ${game.bet === n ? 'selected' : ''}`}
            disabled={!betting || n > game.balance}
            aria-label={`Bet ${n} credits`}
            aria-pressed={game.bet === n}
            onClick={() => act({ type: 'BET', amount: n })}
          >
            <span>{n}</span>
          </button>
        ))}
      </div>
      <div className={`actions ${betting ? 'betting-actions' : ''}`}>
        {betting ? (
          <button
            className="primary deal-button"
            disabled={!broke && game.balance < game.bet}
            onClick={() => (broke ? reset() : act({ type: 'DEAL' }))}
          >
            {broke ? (
              <>
                <RotateCcw size={18} /> Start fresh
              </>
            ) : (
              <>
                {game.phase === 'settled' ? 'Deal again' : 'Deal me in'}
                <ArrowUpRight size={19} />
              </>
            )}
          </button>
        ) : (
          <>
            <button className="primary" disabled={!playing} onClick={() => act({ type: 'HIT' })}>
              Hit <kbd>H</kbd>
            </button>
            <button
              className="secondary"
              disabled={!playing}
              onClick={() => act({ type: 'STAND' })}
            >
              Stand <kbd>S</kbd>
            </button>
            <button
              className="secondary"
              disabled={!canDouble(game)}
              onClick={() => act({ type: 'DOUBLE' })}
            >
              Double <kbd>D</kbd>
            </button>
            <button
              className="secondary"
              disabled={!canSplit(game)}
              onClick={() => act({ type: 'SPLIT' })}
            >
              Split <kbd>P</kbd>
            </button>
          </>
        )}
        <small className="action-hint">
          {broke
            ? 'Reset your session for 2,500 credits'
            : betting
              ? 'A little luck. A little instinct.'
              : playing
                ? 'Make your next move'
                : game.phase === 'dealer'
                  ? 'Dealer is playing…'
                  : 'Cards in motion…'}
        </small>
      </div>
    </footer>
  );
}
