/**
 * Small linear least squares: solve the normal equations by Gaussian
 * elimination. Enough for the handful of unknowns the fits here need
 * (a slope plus an intercept per unbroken stretch of audio).
 */

export interface LsqResult {
  coef: number[];
  resid: number[];
  /** Residual variance, s². */
  s2: number;
  /** Variance of coefficient k (needs s2): s² · (XᵀX)⁻¹ₖₖ. */
  variance(k: number): number;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-12)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Least squares for y ≈ X·coef, X given row by row. */
export function lsq(X: number[][], y: number[]): LsqResult | null {
  const m = X.length;
  const p = X[0]?.length ?? 0;
  if (!p || m <= p) return null;
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < m; i++) {
    const x = X[i];
    for (let j = 0; j < p; j++) {
      if (x[j] === 0) continue;
      b[j] += x[j] * y[i];
      for (let k = 0; k < p; k++) A[j][k] += x[j] * x[k];
    }
  }
  const coef = solve(A, b);
  if (!coef) return null;
  const resid = X.map((x, i) => y[i] - x.reduce((s, v, j) => s + v * coef[j], 0));
  const s2 = resid.reduce((s, e) => s + e * e, 0) / Math.max(1, m - p);
  return {
    coef,
    resid,
    s2,
    variance(k: number) {
      const e = new Array<number>(p).fill(0);
      e[k] = 1;
      const col = solve(A, e);
      return col ? Math.max(0, s2 * col[k]) : NaN;
    },
  };
}

/** Index of the stretch each time falls in, given sorted break times. */
export function segmentOf(t: number, breaks: number[]): number {
  let lo = 0;
  let hi = breaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (breaks[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
