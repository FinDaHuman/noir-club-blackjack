import { useEffect, useState } from 'react';
import { Coins, Minus, Plus, ArrowUpRight } from 'lucide-react';
import { keyLabel, type Settings, type ShortcutAction } from '../settings';
import {
  canBet,
  canRefill,
  canDouble,
  canSplit,
  canSurrender,
  credits,
  type Action,
  type Game,
} from '../game';
export function Controls({
  game,
  act,
  continueSession,
  settings,
}: {
  game: Game;
  act: (action: Action) => void;
  continueSession: () => void;
  settings: Settings;
}) {
  const shortcut = (action: ShortcutAction) =>
    settings.hotkeys
      ? settings.keys[action] === ' '
        ? 'Space'
        : settings.keys[action].toUpperCase()
      : undefined;
  const hint = (action: ShortcutAction) => (
    <kbd aria-hidden="true">{keyLabel(settings.keys[action])}</kbd>
  );
  const betting = canBet(game);
  const playing = game.phase === 'player';
  const broke = canRefill(game);
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
        <small>
          {game.insuranceBet && !betting
            ? `INSURANCE ${credits(game.insuranceBet)}`
            : 'VIRTUAL CREDITS'}
        </small>
      </div>
      <div className="bet-controls">
        <label className="eyeline" htmlFor="wager">
          {betting ? 'Bet amount' : 'On the table'}
        </label>
        <div className="bet-input">
          <button
            className="adjust"
            aria-label="Decrease bet"
            disabled={!betting || broke || game.bet <= 10}
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
            disabled={!betting || broke}
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
      <div
        className={`actions ${betting ? 'betting-actions' : game.phase === 'insurance' ? 'insurance-actions' : 'playing-actions'}`}
      >
        {betting ? (
          <button
            className="primary deal-button"
            aria-label={
              broke ? 'Continue playing' : game.phase === 'settled' ? 'Deal again' : 'Deal me in'
            }
            aria-keyshortcuts={shortcut('DEAL')}
            disabled={!broke && game.balance < game.bet}
            onClick={() => (broke ? continueSession() : act({ type: 'DEAL' }))}
          >
            {broke ? (
              <>
                Continue playing {hint('DEAL')} <ArrowUpRight size={19} />
              </>
            ) : (
              <>
                {game.phase === 'settled' ? 'Deal again' : 'Deal me in'}
                {hint('DEAL')}
                <ArrowUpRight size={19} />
              </>
            )}
          </button>
        ) : game.phase === 'insurance' ? (
          <>
            <button className="primary" onClick={() => act({ type: 'DECLINE_INSURANCE' })}>
              No insurance
            </button>
            <button
              className="secondary"
              disabled={game.balance < game.hands[0].bet / 2}
              onClick={() => act({ type: 'INSURE' })}
            >
              Insure · {credits(game.hands[0].bet / 2)}
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              aria-label="Hit"
              aria-keyshortcuts={shortcut('HIT')}
              disabled={!playing}
              onClick={() => act({ type: 'HIT' })}
            >
              Hit {hint('HIT')}
            </button>
            <button
              className="secondary"
              aria-label="Stand"
              aria-keyshortcuts={shortcut('STAND')}
              disabled={!playing}
              onClick={() => act({ type: 'STAND' })}
            >
              Stand {hint('STAND')}
            </button>
            <button
              className="secondary"
              disabled={!canDouble(game)}
              aria-label="Double"
              aria-keyshortcuts={shortcut('DOUBLE')}
              onClick={() => act({ type: 'DOUBLE' })}
            >
              Double {hint('DOUBLE')}
            </button>
            <button
              className="secondary"
              disabled={!canSplit(game)}
              aria-label="Split"
              aria-keyshortcuts={shortcut('SPLIT')}
              onClick={() => act({ type: 'SPLIT' })}
            >
              Split {hint('SPLIT')}
            </button>
            <button
              className="secondary surrender-button"
              disabled={!canSurrender(game)}
              aria-label="Surrender"
              aria-keyshortcuts={shortcut('SURRENDER')}
              onClick={() => act({ type: 'SURRENDER' })}
            >
              Surrender {hint('SURRENDER')}
            </button>
          </>
        )}
        <small className="action-hint">
          {broke
            ? 'Add credits and keep your stats'
            : betting
              ? 'A little luck. A little instinct.'
              : game.phase === 'insurance'
                ? `Optional side bet · pays 2:1 on dealer blackjack${game.balance < game.hands[0].bet / 2 ? ' · insufficient credits' : ''}`
                : game.phase === 'peeking'
                  ? 'Dealer is checking the hidden card…'
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
