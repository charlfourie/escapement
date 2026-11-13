import { DEFAULT_SIM, type SimParams } from './audio/synth';
import { DEFAULT_DETECTOR } from './audio/detector';

export interface Prefs {
  source: 'mic' | 'sim';
  deviceId: string;
  sensitivity: number;
  /** Let the bank of detectors find the trigger level and filter. */
  autoTrigger: boolean;
  traceSpan: number;
  sim: SimParams;
  lastWatch: string;
  listen: boolean;
}

const KEY = 'escapement:prefs';
const DEFAULTS: Prefs = {
  source: 'mic',
  deviceId: '',
  sensitivity: DEFAULT_DETECTOR.sensitivity,
  autoTrigger: true,
  traceSpan: 10,
  sim: DEFAULT_SIM,
  lastWatch: '',
  listen: false,
};

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...raw, sim: { ...DEFAULT_SIM, ...(raw.sim ?? {}) } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
}
