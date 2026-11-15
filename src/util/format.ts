import { COSC } from '../analysis/analyze';

export const fmtRate = (r: number, decimals = 1) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals)}`;
export const fmtMs = (v: number | null) => (v === null ? '—' : v.toFixed(1));
export const fmtBph = (b: number) => b.toLocaleString('en-US');
export const fmtHz = (b: number) => `${(b / 7200).toFixed(1).replace(/\.0$/, '')} Hz`;

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDuration = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type Grade = 'good' | 'ok' | 'bad';
/** good = within COSC, ok = within ±15 s/d, bad = beyond. */
export function rateGrade(r: number): Grade {
  if (r >= COSC.min && r <= COSC.max) return 'good';
  if (Math.abs(r) <= 15) return 'ok';
  return 'bad';
}
export const gradeLabel: Record<Grade, string> = {
  good: 'Within COSC',
  ok: 'Within ±15 s/d',
  bad: 'Needs regulating',
};

export function beatErrorGrade(be: number | null): Grade {
  if (be === null) return 'ok';
  if (be <= 0.6) return 'good';
  if (be <= 1.5) return 'ok';
  return 'bad';
}

/** Search link for a calibre on Ranfft DB (ranfft.org), the community movement encyclopedia. */
export function ranfftUrl(brand: string, caliber: string): string {
  return `https://ranfft.org/calibers?quick=${encodeURIComponent([brand, caliber].filter((x) => x.trim()).join(' '))}`;
}
