import { useState } from 'react';
import { Dialog } from './Tracker';
import {
  DEFAULT_SETTINGS,
  keyLabel,
  SHORTCUTS,
  validKey,
  type Settings as Preferences,
  type ShortcutAction,
} from '../settings';

export function Settings({
  settings,
  change,
  close,
  previewSound,
}: {
  settings: Preferences;
  change: (settings: Preferences) => void;
  close: () => void;
  previewSound: () => void;
}) {
  const [listening, setListening] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    change({ ...settings, [key]: value });
  return (
    <Dialog title="Table settings" close={close}>
      <p className="dialog-intro">
        Make yourself comfortable. Your preferences are saved on this device.
      </p>
      <section className="settings-section" aria-labelledby="audio-heading">
        <h3 id="audio-heading">Sound & music</h3>
        {(
          [
            ['music', 'musicVolume', 'Background music'],
            ['effects', 'effectsVolume', 'Sound effects'],
          ] as const
        ).map(([enabled, volume, label]) => (
          <div className="volume-setting" key={enabled}>
            <label className="setting-toggle">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={settings[enabled]}
                onChange={(e) => update(enabled, e.target.checked)}
              />
            </label>
            <label className="volume-slider">
              <span className="sr-only">{label} volume</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={settings[volume]}
                onChange={(e) => update(volume, Number(e.target.value))}
              />
              <output>{settings[volume]}%</output>
            </label>
          </div>
        ))}
        <button
          className="text-button"
          onClick={previewSound}
          disabled={!settings.effects || settings.effectsVolume === 0}
        >
          Preview sound effect
        </button>
      </section>
      <section className="settings-section" aria-labelledby="pace-heading">
        <h3 id="pace-heading">Table pace</h3>
        <label className="setting-row">
          <span>Dealing speed</span>
          <select
            value={settings.speed}
            onChange={(e) => update('speed', e.target.value as Preferences['speed'])}
          >
            <option value="relaxed">Relaxed</option>
            <option value="normal">Normal</option>
            <option value="quick">Quick</option>
          </select>
        </label>
        <p className="setting-note">
          Changes card movement and dealer pacing together. Split aces are always dealt one at a
          time.
        </p>
        <label className="setting-toggle">
          <span>Reduce motion</span>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => update('reducedMotion', e.target.checked)}
          />
        </label>
        <p className="setting-note">
          Use instant card transitions. Your device’s reduced-motion preference is also respected.
        </p>
      </section>
      <section className="settings-section desktop-only" aria-labelledby="keyboard-heading">
        <h3 id="keyboard-heading">Keyboard shortcuts</h3>
        <label className="setting-toggle">
          <span>Enable keyboard shortcuts</span>
          <input
            type="checkbox"
            checked={settings.hotkeys}
            onChange={(e) => update('hotkeys', e.target.checked)}
          />
        </label>
        <label className="setting-toggle">
          <span>Show shortcut hints</span>
          <input
            type="checkbox"
            checked={settings.showHints}
            onChange={(e) => update('showHints', e.target.checked)}
          />
        </label>
        <p className="setting-note">
          Select a key, then press a letter, number, or Space. Escape cancels. Shortcuts pause in
          dialogs and while typing.
        </p>
        <div className="key-bindings">
          {SHORTCUTS.map(([action, label]) => (
            <div className="key-binding" key={action}>
              <span>{label}</span>
              <button
                className={`key-binding-button ${listening === action ? 'listening' : ''}`}
                aria-label={`Change ${label.toLowerCase()} shortcut`}
                onClick={() => {
                  setListening(action);
                  setError('');
                }}
                onBlur={() => setListening(null)}
                onKeyDown={(e) => {
                  if (listening !== action) return;
                  if (e.key === 'Tab') {
                    setListening(null);
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    setListening(null);
                    setError('');
                    return;
                  }
                  const key = e.key.toLowerCase();
                  if (e.ctrlKey || e.metaKey || e.altKey || !validKey(key)) {
                    setError('Choose a letter, number, or Space without modifiers.');
                    return;
                  }
                  const conflict = SHORTCUTS.find(
                    ([other]) => other !== action && settings.keys[other] === key,
                  );
                  if (conflict) {
                    setError(
                      `${keyLabel(key)} is already assigned to ${conflict[1]}. Choose another key.`,
                    );
                    return;
                  }
                  update('keys', { ...settings.keys, [action]: key });
                  setListening(null);
                  setError('');
                }}
              >
                {listening === action ? 'Press a key…' : keyLabel(settings.keys[action])}
              </button>
            </div>
          ))}
        </div>
        <p className="key-feedback" role="status">
          {error || (listening ? 'Waiting for your new shortcut…' : '')}
        </p>
        <button
          className="text-button"
          onClick={() => {
            update('keys', { ...DEFAULT_SETTINGS.keys });
            setError('');
            setListening(null);
          }}
        >
          Reset shortcuts
        </button>
      </section>
      <p className="setting-note settings-footer">
        Your game pauses while this panel is open. Settings do not change your bankroll or stats.
      </p>
    </Dialog>
  );
}
