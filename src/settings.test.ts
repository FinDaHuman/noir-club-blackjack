import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  SETTINGS_KEY,
  SPEED_FACTOR,
} from './settings';

afterEach(() => vi.unstubAllGlobals());
describe('saved table settings', () => {
  it.each(Object.keys(SPEED_FACTOR))('preserves the %s speed preference', (speed) => {
    expect(normalizeSettings({ speed }).speed).toBe(speed);
  });
  it.each([null, 'invalid', 42, [], { keys: null }])(
    'recovers safely from malformed settings: %j',
    (value) => {
      expect(normalizeSettings(value)).toEqual(DEFAULT_SETTINGS);
    },
  );
  it('bounds volumes and rejects invalid preferences', () => {
    expect(
      normalizeSettings({
        musicVolume: 150,
        effectsVolume: -20,
        music: 'false',
        speed: 'instant',
        hotkeys: false,
      }),
    ).toMatchObject({
      musicVolume: 100,
      effectsVolume: 0,
      music: true,
      speed: 'normal',
      hotkeys: false,
    });
    expect(normalizeSettings({ musicVolume: NaN, effectsVolume: Infinity })).toEqual(
      DEFAULT_SETTINGS,
    );
  });
  it('accepts unique shortcuts but rejects collisions and reserved keys', () => {
    const keys = { ...DEFAULT_SETTINGS.keys, HIT: 'x', DEAL: '1' };
    expect(normalizeSettings({ keys }).keys).toEqual(keys);
    expect(normalizeSettings({ keys: { ...keys, STAND: 'x' } }).keys).toEqual(
      DEFAULT_SETTINGS.keys,
    );
    expect(normalizeSettings({ keys: { ...keys, STAND: 'Escape' } }).keys).toEqual(
      DEFAULT_SETTINGS.keys,
    );
    expect(normalizeSettings({ keys: { HIT: 'x' } }).keys).toEqual(DEFAULT_SETTINGS.keys);
  });
  it('migrates existing music and effects preferences', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'noir-club.audio' ? JSON.stringify({ music: false, effects: false }) : null,
    });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, music: false, effects: false });
  });
  it('uses new settings in preference to the old audio record', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === SETTINGS_KEY
          ? JSON.stringify({ speed: 'relaxed', musicVolume: 30 })
          : JSON.stringify({ music: false }),
    });
    expect(loadSettings()).toMatchObject({ speed: 'relaxed', musicVolume: 30, music: true });
  });
  it('works when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
