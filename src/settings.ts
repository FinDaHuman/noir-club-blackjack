export const SETTINGS_KEY = 'noir-club.settings.v1';
export const SHORTCUTS = [
  ['HIT', 'Hit'],
  ['STAND', 'Stand'],
  ['DOUBLE', 'Double'],
  ['SPLIT', 'Split'],
  ['SURRENDER', 'Surrender'],
  ['DEAL', 'Deal cards'],
] as const;
export type ShortcutAction = (typeof SHORTCUTS)[number][0];
export type Settings = {
  music: boolean;
  effects: boolean;
  musicVolume: number;
  effectsVolume: number;
  speed: 'slow' | 'relaxed' | 'normal' | 'quick' | 'fast';
  reducedMotion: boolean;
  hotkeys: boolean;
  showHints: boolean;
  strategyHints: boolean;
  liveFeedback: boolean;
  keys: Record<ShortcutAction, string>;
};
export const DEFAULT_SETTINGS: Settings = {
  music: true,
  effects: true,
  musicVolume: 65,
  effectsVolume: 80,
  speed: 'normal',
  reducedMotion: false,
  hotkeys: true,
  showHints: true,
  strategyHints: false,
  liveFeedback: false,
  keys: { HIT: 'h', STAND: 's', DOUBLE: 'd', SPLIT: 'p', SURRENDER: 'r', DEAL: ' ' },
};
export const SPEED_FACTOR = { slow: 2, relaxed: 1.5, normal: 1, quick: 0.7, fast: 0.5 };
export const keyLabel = (key: string) => (key === ' ' ? 'Space' : key.toUpperCase());
export const validKey = (key: string) => /^[a-z0-9 ]$/.test(key);

export function normalizeSettings(value: unknown): Settings {
  const source = value && typeof value === 'object' ? (value as Partial<Settings>) : {};
  const result = { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_SETTINGS.keys } };
  for (const key of [
    'music',
    'effects',
    'reducedMotion',
    'hotkeys',
    'showHints',
    'strategyHints',
    'liveFeedback',
  ] as const)
    if (typeof source[key] === 'boolean') result[key] = source[key];
  for (const key of ['musicVolume', 'effectsVolume'] as const)
    if (typeof source[key] === 'number' && Number.isFinite(source[key]))
      result[key] = Math.round(Math.max(0, Math.min(100, source[key])));
  if (source.speed && Object.hasOwn(SPEED_FACTOR, source.speed)) result.speed = source.speed;
  // A malformed or colliding mapping falls back as a group, keeping every action reachable.
  if (
    source.keys &&
    SHORTCUTS.every(
      ([action]) => typeof source.keys?.[action] === 'string' && validKey(source.keys[action]),
    ) &&
    new Set(SHORTCUTS.map(([action]) => source.keys![action])).size === SHORTCUTS.length
  )
    result.keys = { ...source.keys };
  return result;
}

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(JSON.parse(saved ?? localStorage.getItem('noir-club.audio') ?? '{}'));
  } catch {
    return normalizeSettings(null);
  }
}
