import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { BarChart3, BookOpen, Expand, Minimize, Settings2, CircleHelp, Spade } from 'lucide-react';
import { audio } from './audio';
import { canBet, canRefill, loadGame, reducer, SAVE_KEY, signed, type Action } from './game';
import { Hand } from './components/Cards';
import { Controls } from './components/Controls';
import { Dialog, Rules, Session, Tracker } from './components/Tracker';
import { Strategy } from './components/Strategy';
import { Settings } from './components/Settings';
import { loadSettings, SETTINGS_KEY, SHORTCUTS, SPEED_FACTOR } from './settings';
import { decisionFeedback, shortChoice, type Feedback } from './coaching';
import { FeedbackDetails, Hint } from './components/Coach';

export default function App() {
  const [game, dispatch] = useReducer(reducer, undefined, loadGame);
  const [modal, setModal] = useState<
    'rules' | 'strategy' | 'tracker' | 'reset' | 'settings' | 'refill' | 'hint' | 'feedback' | null
  >(null);
  const [settings, setSettings] = useState(loadSettings);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const speed = SPEED_FACTOR[settings.speed];
  const reducedMotion = settings.reducedMotion || systemReducedMotion;
  const storageWarned = useRef(false);
  const preview = game.phase === 'betting';
  const dealerHidden = !['dealer', 'settled'].includes(game.phase);
  const unlock = useCallback(() => {
    void audio.unlock().then((ok) => {
      if (!ok) setNotice('Audio is unavailable in this browser. You can still play.');
    });
  }, []);
  const act = useCallback(
    (action: Action) => {
      unlock();
      if (action.type === 'BET') audio.play('chip');
      if (action.type === 'DEAL' && canRefill(game)) {
        setModal('refill');
        return;
      }
      if (action.type === 'DEAL' && canBet(game) && game.balance >= game.bet) setFeedback(null);
      if (settings.liveFeedback) {
        const nextFeedback = decisionFeedback(game, action);
        if (nextFeedback) setFeedback(nextFeedback);
      }
      dispatch(action);
    },
    [unlock, game, settings.liveFeedback],
  );
  useEffect(() => {
    if (!feedback || modal) return;
    const timer = setTimeout(() => setFeedback(null), 6500);
    return () => clearTimeout(timer);
  }, [feedback, modal]);
  useEffect(() => {
    audio.configure(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* Playback still works without storage. */
    }
  }, [settings]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    } catch {
      if (!storageWarned.current) {
        storageWarned.current = true;
        setNotice('Device storage is unavailable. This session will not survive a reload.');
      }
    }
  }, [game]);
  useEffect(() => {
    if (modal || !pageVisible) return;
    const delays: Record<string, number> = {
      dealing: 1200,
      peeking: 1100,
      hitting: 600,
      splitting: 650,
      'split-dealing': 1000,
      dealer: 850,
    };
    const delay = delays[game.phase];
    if (!delay) return;
    const timer = setTimeout(
      () => dispatch({ type: game.phase === 'dealer' ? 'DEALER_TICK' : 'READY' }),
      delay * speed,
    );
    return () => clearTimeout(timer);
  }, [game.phase, game.dealer.length, game.active, modal, pageVisible, speed]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (game.phase === 'dealing')
      [0, 200, 400, 600].forEach((ms) =>
        timers.push(setTimeout(() => audio.play('card'), ms * speed)),
      );
    else if (['hitting', 'splitting', 'split-dealing', 'dealer', 'peeking'].includes(game.phase))
      audio.play('card');
    else if (game.phase === 'settled') {
      const net = game.history[0]?.net ?? 0;
      audio.play(net > 0 ? 'win' : net < 0 ? 'loss' : 'push');
    }
    return () => timers.forEach(clearTimeout);
  }, [game.phase, game.dealer.length, game.active, speed]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        modal ||
        !settings.hotkeys ||
        e.isComposing ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof Element &&
          e.target.closest('input,select,textarea,[contenteditable="true"]'))
      )
        return;
      if (e.key === ' ' && e.target instanceof Element && e.target.closest('button,a')) return;
      const type = SHORTCUTS.find(([action]) => settings.keys[action] === e.key.toLowerCase())?.[0];
      if (type) {
        e.preventDefault();
        act({ type });
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [act, modal, settings.hotkeys, settings.keys]);
  useEffect(() => {
    const fn = () => {
      audio.visibility(document.hidden);
      setPageVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', fn);
    const fs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fs);
    return () => {
      document.removeEventListener('visibilitychange', fn);
      document.removeEventListener('fullscreenchange', fs);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      void document.documentElement
        .requestFullscreen()
        .catch(() => setNotice('Fullscreen is unavailable. The table already fills your browser.'));
    else
      setNotice('The table fills your browser. Add it to your Home Screen for an immersive view.');
  };
  return (
    <div
      className={`app ${reducedMotion ? 'reduce-motion' : ''} ${settings.hotkeys && settings.showHints ? 'show-hotkeys' : ''}`}
      data-phase={game.phase}
      style={
        {
          '--deal-duration': `${480 * speed}ms`,
          '--split-deal-duration': `${720 * speed}ms`,
          '--reveal-duration': `${520 * speed}ms`,
          '--peek-duration': `${1050 * speed}ms`,
          '--move-duration': `${350 * speed}ms`,
        } as CSSProperties
      }
    >
      <div className="felt" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="./" aria-label="Noir Club Blackjack home">
          <Spade className="brand-spade" fill="currentColor" strokeWidth={0.6} />
          <div>
            <span>NOIR CLUB</span>
            <small>BLACKJACK</small>
          </div>
        </a>
        <nav aria-label="Table settings">
          <button
            className="learn-button"
            aria-label="Learn basic strategy"
            onClick={() => setModal('strategy')}
          >
            <BookOpen size={17} />
            <span>Learn</span>
          </button>
          <button className="rules-button" aria-label="Rules" onClick={() => setModal('rules')}>
            <CircleHelp size={18} />
            <span>Rules</span>
          </button>
          <span className="nav-divider" />
          <button
            className="icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setModal('settings')}
          >
            <Settings2 />
          </button>
          <button
            className="icon-button mobile-tracker"
            aria-label="Open player tracker"
            onClick={() => setModal('tracker')}
          >
            <BarChart3 />
          </button>
          <span className="nav-divider fullscreen-divider" />
          <button
            className="icon-button fullscreen-button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize /> : <Expand />}
          </button>
        </nav>
      </header>
      <main
        className={`table ${game.hands.length > 1 ? 'is-split' : ''} ${game.hands.length > 2 ? 'many-hands' : ''} ${settings.liveFeedback ? 'with-feedback' : ''}`}
        style={{ '--seats': game.hands.length } as CSSProperties}
        aria-label="Blackjack table"
      >
        <div className="dealer-area">
          <Hand
            cards={game.dealer}
            label="Dealer"
            hidden={dealerHidden}
            dealer
            dealing={game.phase === 'dealing'}
            preview={preview}
            peeking={game.phase === 'peeking'}
            speed={speed}
            reducedMotion={reducedMotion}
          />
        </div>
        <svg
          className="table-lettering"
          viewBox="0 0 900 175"
          aria-label="Blackjack pays 3 to 2. Dealer stands on all 17."
        >
          <defs>
            <path id="letter-arc" d="M95 15 Q450 145 805 15" />
            <path id="rule-arc" d="M145 72 Q450 178 755 72" />
          </defs>
          <path className="table-line" d="M65 96 Q450 245 835 96" />
          <text className="table-title">
            <textPath href="#letter-arc" startOffset="50%" textAnchor="middle">
              BLACKJACK PAYS 3 TO 2
            </textPath>
          </text>
          <text className="table-rule">
            <textPath href="#rule-arc" startOffset="50%" textAnchor="middle">
              DEALER STANDS ON ALL 17
            </textPath>
          </text>
        </svg>
        <div className="players-area">
          {preview ? (
            <div className="empty-seat">
              <Spade size={30} strokeWidth={1} />
              <span>Your seat awaits</span>
              <button className="text-button" onClick={() => setModal('strategy')}>
                New to blackjack? Learn to play
              </button>
            </div>
          ) : (
            game.hands.map((hand, i) => (
              <Hand
                key={i}
                cards={hand.cards}
                label={game.hands.length === 1 ? 'Your hand' : `Hand ${i + 1} · ${hand.bet}`}
                active={
                  game.active === i && ['player', 'splitting', 'split-dealing'].includes(game.phase)
                }
                waiting={hand.cards.length === 1}
                oneCardOnly={hand.split && hand.cards[0].rank === 'A'}
                split={hand.split}
                result={hand.result}
                dealing={game.phase === 'dealing'}
                speed={speed}
                reducedMotion={reducedMotion}
              />
            ))
          )}
        </div>
        <Session game={game} open={() => setModal('tracker')} />
        <div
          className={`table-message ${game.phase === 'settled' && game.history[0]?.net > 0 ? 'won' : ''}`}
          role="status"
          aria-live="polite"
        >
          {settings.liveFeedback && feedback ? (
            <button
              className={`decision-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}
              aria-label="Explain my last choice"
              onClick={() => setModal('feedback')}
            >
              <strong>
                {shortChoice(feedback.chosen)} ·{' '}
                {feedback.correct ? 'Correct' : `Better: ${shortChoice(feedback.expected)}`}
              </strong>
              <span>Basic strategy · Why?</span>
            </button>
          ) : (
            <span>{game.message}</span>
          )}
          {game.phase === 'settled' ? (
            <b>{signed(game.history[0]?.net ?? 0)} credits</b>
          ) : preview ? (
            <small>Choose your chips. Make yourself at home.</small>
          ) : null}
        </div>
        <div className="table-note">
          SIX DECKS <span>·</span> YOUR PRIVATE TABLE
        </div>
      </main>
      <Controls
        game={game}
        act={act}
        continueSession={() => setModal('refill')}
        settings={settings}
        showHint={() => setModal('hint')}
      />
      {modal === 'rules' && <Rules close={() => setModal(null)} settings={settings} />}
      {modal === 'settings' && (
        <Settings
          settings={settings}
          change={(next) => {
            if (!next.liveFeedback) setFeedback(null);
            audio.configure(next);
            setSettings(next);
            unlock();
          }}
          close={() => setModal(null)}
          previewSound={() => audio.preview()}
        />
      )}
      {modal === 'strategy' && <Strategy game={game} close={() => setModal(null)} />}
      {modal === 'hint' && settings.strategyHints && (
        <Hint game={game} close={() => setModal(null)} />
      )}
      {modal === 'feedback' && settings.liveFeedback && feedback && (
        <FeedbackDetails feedback={feedback} close={() => setModal(null)} />
      )}
      {modal === 'tracker' && (
        <Tracker game={game} close={() => setModal(null)} reset={() => setModal('reset')} />
      )}
      {modal === 'refill' && (
        <Dialog title="Keep your story going" close={() => setModal(null)}>
          <p className="dialog-intro">
            Your bankroll is below the 10-credit minimum. Add 2,500 virtual credits and keep your
            hand history, accuracy, and stats. Your net result stays at {signed(game.stats.net)} and
            continues from there; added credits never count as winnings.
          </p>
          <div className="reset-actions">
            <button className="secondary" onClick={() => setModal('reset')}>
              Reset stats instead
            </button>
            <button
              className="primary"
              disabled={!canRefill(game)}
              onClick={() => {
                dispatch({ type: 'REFILL' });
                setFeedback(null);
                setModal(null);
              }}
            >
              Add 2,500 · keep stats
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'reset' && (
        <Dialog title="A fresh start?" close={() => setModal(null)}>
          <p className="dialog-intro">
            This clears your saved history and stats, and restores your bankroll to 2,500 virtual
            credits.
          </p>
          <div className="reset-actions">
            <button className="secondary" onClick={() => setModal('tracker')}>
              Keep my session
            </button>
            <button
              className="primary"
              disabled={!canBet(game)}
              onClick={() => {
                dispatch({ type: 'RESET' });
                setFeedback(null);
                setModal(null);
              }}
            >
              Start fresh
            </button>
          </div>
        </Dialog>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
