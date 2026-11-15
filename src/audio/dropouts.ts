/**
 * Spots audio dropouts by comparing the sound card's clock with the
 * computer's. They normally advance together (apart from a few ppm); when the
 * audio stalls, the sound card's clock pauses and the gap between them jumps
 * and stays at the new level. One-off spikes in the timestamps are ignored.
 */
export class DropoutDetector {
  readonly dropouts: Array<{ at: number; gap: number }> = [];
  private drifts: number[] = [];
  private pending: { at: number; drift: number } | null = null;

  /**
   * One observation: sound-card time and computer time (seconds) at the same
   * moment. `tol` is how far a reading can wander without being a dropout.
   */
  feed(audio: number, computer: number, tol = 0.015): void {
    const drift = computer - audio;
    const sorted = [...this.drifts].sort((a, b) => a - b);
    const base = sorted.length ? sorted[sorted.length >> 1] : drift;
    if (this.drifts.length >= 3 && Math.abs(drift - base) > tol) {
      if (this.pending && Math.abs(drift - this.pending.drift) < tol) {
        this.dropouts.push({ at: this.pending.at, gap: this.pending.drift - base });
        this.drifts = [drift];
        this.pending = null;
      } else {
        this.pending = { at: audio, drift };
      }
      return;
    }
    this.pending = null;
    this.drifts.push(drift);
    if (this.drifts.length > 8) this.drifts.shift();
  }
}
