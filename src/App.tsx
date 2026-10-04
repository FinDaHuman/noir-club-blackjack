import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Expand,
  Minimize,
  Music2,
  Volume2,
  VolumeX,
  Spade,
} from 'lucide-react';
import { audio } from './audio';
import { canBet, loadGame, reducer, SAVE_KEY, signed, type Action } from './game';
import { Hand } from './components/Cards';
import { Controls } from './components/Controls';
import { Dialog, Rules, Session, Tracker } from './components/Tracker';
import { Strategy } from './components/Strategy';

function readPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem('noir-club.audio') || '{}');
    return prefs && typeof prefs === 'object' ? prefs : {};
  } catch {
    return {};
  }
}
export default function App() {
  const [game, dispatch] = useReducer(reducer, undefined, loadGame);
  const [modal, setModal] = useState<'rules' | 'strategy' | 'tracker' | 'reset' | null>(null);
  const [effects, setEffects] = useState(() => readPrefs().effects !== false);
  const [music, setMusic] = useState(() => readPrefs().music !== false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const [audioStarted, setAudioStarted] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const storageWarned = useRef(false);
  const preview = game.phase === 'betting';
  const dealerHidden = !['dealer', 'settled'].includes(game.phase);
  const unlock = useCallback(() => {
    void audio.unlock().then((ok) => {
      if (ok) setAudioStarted(true);
      else setNotice('Audio is unavailable in this browser. You can still play.');
    });
  }, []);
  const act = useCallback(
    (action: Action) => {
      unlock();
      if (action.type === 'BET') audio.play('chip');
      dispatch(action);
    },
    [unlock],
  );
  useEffect(() => {
    audio.effects = effects;
    audio.setMusic(music);
    try {
      localStorage.setItem('noir-club.audio', JSON.stringify({ effects, music }));
    } catch {
      /* Playback still works without storage. */
    }
  }, [effects, music]);
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
      delay,
    );
    return () => clearTimeout(timer);
  }, [game.phase, game.dealer.length, game.active, modal, pageVisible]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (game.phase === 'dealing')
      [0, 200, 400, 600].forEach((ms) => timers.push(setTimeout(() => audio.play('card'), ms)));
    else if (['hitting', 'splitting', 'split-dealing', 'dealer', 'peeking'].includes(game.phase))
      audio.play('card');
    else if (game.phase === 'settled') {
      const net = game.history[0]?.net ?? 0;
      audio.play(net > 0 ? 'win' : net < 0 ? 'loss' : 'push');
    }
    return () => timers.forEach(clearTimeout);
  }, [game.phase, game.dealer.length, game.active]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        modal ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof Element && e.target.closest('input,select,textarea'))
      )
        return;
      if (e.key === ' ' && e.target instanceof Element && e.target.closest('button,a')) return;
      const type = (
        { ' ': 'DEAL', h: 'HIT', s: 'STAND', d: 'DOUBLE', p: 'SPLIT', r: 'SURRENDER' } as const
      )[e.key.toLowerCase() as ' '];
      if (type) {
        e.preventDefault();
        act({ type });
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [act, modal]);
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
    <div className="app" data-phase={game.phase}>
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
          <button className="rules-button" onClick={() => setModal('rules')}>
            Rules
          </button>
          <span className="nav-divider" />
          <button
            className="icon-button"
            aria-label={effects ? 'Mute sound effects' : 'Enable sound effects'}
            aria-pressed={effects}
            title="Sound effects"
            onClick={() => {
              unlock();
              setEffects(!effects);
            }}
          >
            {effects ? <Volume2 /> : <VolumeX />}
          </button>
          <button
            className={`icon-button music-button ${!music ? 'muted' : ''}`}
            aria-label={music ? 'Mute background music' : 'Enable background music'}
            aria-pressed={music}
            title="Lounge music"
            onClick={() => {
              unlock();
              setMusic(!music);
            }}
          >
            <Music2 />
            {music && audioStarted && <i className="music-indicator" />}
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
        className={`table ${game.hands.length > 1 ? 'is-split' : ''}`}
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
                result={hand.result}
                dealing={game.phase === 'dealing'}
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
          <span>{game.message}</span>
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
      <Controls game={game} act={act} reset={() => setModal('reset')} />
      {modal === 'rules' && <Rules close={() => setModal(null)} />}
      {modal === 'strategy' && <Strategy game={game} close={() => setModal(null)} />}
      {modal === 'tracker' && (
        <Tracker game={game} close={() => setModal(null)} reset={() => setModal('reset')} />
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
