import { downsample, type Analysis } from '../analysis/analyze';
import { blankWatch, db, isTimegraphable, newId, POSITIONS, WIND_STATES, type Position, type Watch, type WindState } from '../db';
import { h, select, toast } from '../util/dom';
import { fmtMs, fmtRate, rateGrade } from '../util/format';

/** Standard order: horizontal positions first, then the four vertical ones. */
export const TEST_ORDER: Position[] = ['DU', 'DD', 'CU', 'CD', 'CL', 'CR'];
/** Seconds to ignore after locking on, while the watch settles in its new position. */
export const SETTLE_SEC = 5;
/** Seconds of locked-on data measured per position. */
export const STEP_SEC = 30;

export interface StepResult {
  position: Position;
  analysis: Analysis;
  amplitude: number | null;
}

type Slot = StepResult | 'skipped' | null;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface TestSummary {
  avgRate: number;
  delta: number;
  horizontal: number | null;
  vertical: number | null;
  avgAmplitude: number | null;
  minAmplitude: number | null;
  maxBeatError: number | null;
  measured: number;
}

export function summarize(results: StepResult[]): TestSummary | null {
  if (!results.length) return null;
  const rates = results.map((r) => r.analysis.rate);
  const pick = (ps: Position[]) => results.filter((r) => ps.includes(r.position)).map((r) => r.analysis.rate);
  const hor = pick(['DU', 'DD']);
  const ver = pick(['CU', 'CD', 'CL', 'CR']);
  const amps = results.map((r) => r.amplitude).filter((a): a is number => a !== null);
  const bes = results.map((r) => r.analysis.beatError).filter((b): b is number => b !== null);
  return {
    avgRate: mean(rates),
    delta: Math.max(...rates) - Math.min(...rates),
    horizontal: hor.length ? mean(hor) : null,
    vertical: ver.length ? mean(ver) : null,
    avgAmplitude: amps.length ? mean(amps) : null,
    minAmplitude: amps.length ? Math.min(...amps) : null,
    maxBeatError: bes.length ? Math.max(...bes) : null,
    measured: results.length,
  };
}

export interface PositionTestHost {
  getWatches: () => Watch[];
  getWatchId: () => string;
  onSaved: (watchId: string) => void | Promise<void>;
  /** Called when the user picks a position to (re)measure. */
  onChange: () => void;
}

/** Guided six-position test: the panel, its state and saving the set. */
export class PositionTest {
  readonly el: HTMLElement;
  private slots: Slot[] = TEST_ORDER.map(() => null);
  private step = 0;
  private progressText = '';
  private progressFrac = 0;
  private running = false;
  private readonly body: HTMLElement;

  constructor(private readonly host: PositionTestHost) {
    this.body = h('div', { class: 'pt-body' });
    this.el = h('section', { class: 'panel position-test' }, h('header', { class: 'panel-head' }, h('h2', null, 'Six-position test'), h('span', { class: 'muted small' }, `${SETTLE_SEC} s to settle + ${STEP_SEC} s per position`)), this.body);
    this.render();
  }

  /** Position currently up for measuring, or null when all are done. */
  get current(): Position | null {
    return this.step < TEST_ORDER.length ? TEST_ORDER[this.step] : null;
  }

  get done(): boolean {
    return this.step >= TEST_ORDER.length;
  }

  setRunning(running: boolean): void {
    this.running = running;
    if (!running) {
      this.progressText = '';
      this.progressFrac = 0;
    }
    this.render();
  }

  setProgress(text: string, frac: number): void {
    this.progressText = text;
    this.progressFrac = Math.max(0, Math.min(1, frac));
    const bar = this.el.querySelector<HTMLElement>('.pt-progress span');
    const label = this.el.querySelector<HTMLElement>('.pt-progress-label');
    if (bar && label) {
      bar.style.width = `${this.progressFrac * 100}%`;
      label.textContent = text;
    } else {
      this.render();
    }
  }

  complete(result: StepResult): void {
    this.slots[this.step] = result;
    this.advance();
  }

  reset(): void {
    this.slots = TEST_ORDER.map(() => null);
    this.step = 0;
    this.render();
    this.host.onChange();
  }

  private advance(): void {
    const next = this.slots.findIndex((s) => s === null);
    this.step = next === -1 ? TEST_ORDER.length : next;
    this.render();
    this.host.onChange();
  }

  private select(i: number): void {
    if (this.running) return;
    this.slots[i] = null;
    this.step = i;
    this.render();
    this.host.onChange();
  }

  private skip(): void {
    if (this.running || this.done) return;
    this.slots[this.step] = 'skipped';
    this.advance();
  }

  private results(): StepResult[] {
    return this.slots.filter((s): s is StepResult => s !== null && s !== 'skipped');
  }

  render(): void {
    const chips = TEST_ORDER.map((p, i) => {
      const s = this.slots[i];
      const isCurrent = i === this.step && !this.done;
      return h(
        'button',
        {
          type: 'button',
          class: `pt-chip${isCurrent ? ' current' : ''}${s && s !== 'skipped' ? ' done' : ''}${s === 'skipped' ? ' skipped' : ''}`,
          title: s && s !== 'skipped' ? 'Measure this position again' : 'Measure this position',
          disabled: this.running,
          onclick: () => this.select(i),
        },
        h('span', { class: 'pt-pos' }, POSITIONS[p]),
        h(
          'span',
          { class: 'pt-val', 'data-grade': s && s !== 'skipped' ? rateGrade(s.analysis.rate) : undefined },
          s === 'skipped' ? 'skipped' : s ? `${fmtRate(s.analysis.rate)} s/d` : isCurrent ? (this.running ? 'measuring' : 'next') : '—',
        ),
      );
    });

    const parts: Array<Node | false> = [h('div', { class: 'pt-chips' }, chips)];

    if (!this.done) {
      const p = this.current!;
      parts.push(
        this.running
          ? h('div', { class: 'pt-progress-wrap' }, h('div', { class: 'pt-progress' }, h('span', { style: `width:${this.progressFrac * 100}%` })), h('p', { class: 'pt-progress-label small muted' }, this.progressText || 'Waiting for the beat…'))
          : h(
              'div',
              { class: 'pt-next' },
              h('p', null, h('strong', null, `Position ${this.step + 1} of 6: ${POSITIONS[p]}. `), instructions(p), ' Then press Start.'),
              h('button', { type: 'button', class: 'btn small', onclick: () => this.skip() }, 'Skip this position'),
            ),
      );
    }

    const results = this.results();
    if (results.length) parts.push(this.summaryBlock(results));
    this.body.replaceChildren(...parts.filter((x): x is Node => Boolean(x)));
  }

  private summaryBlock(results: StepResult[]): HTMLElement {
    const s = summarize(results)!;
    const stat = (label: string, value: string, grade?: string) => h('div', { class: 'stat', 'data-grade': grade }, h('div', { class: 'ro-label' }, label), h('div', { class: 'stat-value' }, value));
    const block = h(
      'div',
      { class: 'pt-summary' },
      h(
        'div',
        { class: 'stat-row pt-stats' },
        stat('Average rate', `${fmtRate(s.avgRate)} s/d`, rateGrade(s.avgRate)),
        stat('Delta', s.measured > 1 ? `${s.delta.toFixed(1)} s/d` : '—'),
        stat('Amplitude (avg)', s.avgAmplitude === null ? '—' : `${Math.round(s.avgAmplitude)}°`),
        stat('Beat error (max)', s.maxBeatError === null ? '—' : `${fmtMs(s.maxBeatError)} ms`),
      ),
      h(
        'p',
        { class: 'muted small' },
        `${s.measured} of 6 positions measured`,
        s.horizontal !== null && s.vertical !== null ? ` · flat ${fmtRate(s.horizontal)} s/d, vertical ${fmtRate(s.vertical)} s/d` : '',
        '. Delta is the spread between the best and worst position; under 10 s/d is good, under 5 is excellent.',
      ),
    );
    if (this.done) block.append(this.saveForm(results));
    return block;
  }

  private saveForm(results: StepResult[]): HTMLElement {
    const watches = this.host.getWatches().filter(isTimegraphable);
    let targetId = this.host.getWatchId() || (watches[0]?.id ?? '__new');
    let wind: WindState = 'unknown';
    const nameInput = h('input', { type: 'text', placeholder: 'e.g. Seiko SPB143' });
    const nameField = h('label', { class: 'field' }, h('span', null, 'New watch name'), nameInput);
    nameField.hidden = targetId !== '__new';
    const notes = h('input', { type: 'text', placeholder: 'Optional, e.g. fresh off a full wind' });
    const saveBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => void save() }, 'Save all positions');

    const save = async () => {
      let target = watches.find((w) => w.id === targetId);
      if (targetId === '__new') {
        const name = nameInput.value.trim();
        if (!name) return void nameInput.focus();
        target = { ...blankWatch(), name, bph: results[0].analysis.bph };
        await db.watches.add(target);
      }
      if (!target) return;
      saveBtn.disabled = true;
      const testId = newId();
      const now = Date.now();
      await db.measurements.bulkAdd(
        results.map((r, i) => ({
          id: newId(),
          watchId: target!.id,
          takenAt: now + i, // keep the test's order stable
          position: r.position,
          wind,
          durationSec: r.analysis.duration,
          bph: r.analysis.bph,
          rate: r.analysis.rate,
          beatError: r.analysis.beatError,
          amplitude: r.amplitude,
          jitter: r.analysis.jitter,
          ticks: r.analysis.ticks,
          quality: r.analysis.quality,
          notes: [`6-position test`, notes.value.trim()].filter(Boolean).join(' · '),
          trace: downsample(r.analysis.points, 400),
          testId,
        })),
      );
      toast(`Saved ${results.length} positions to ${target.name}`);
      await this.host.onSaved(target.id);
      this.body.replaceChildren(
        h('p', null, `Saved ${results.length} positions to ${target.name}. `, h('a', { href: `#/watches/${target.id}` }, 'View history →')),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => this.reset() }, 'Start a new test')),
      );
    };

    return h(
      'div',
      { class: 'pt-save' },
      h(
        'div',
        { class: 'form-grid' },
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Watch'),
          select([...watches.map((w): [string, string] => [w.id, w.name]), ['__new', '+ New watch…']], targetId, (v) => {
            targetId = v;
            nameField.hidden = v !== '__new';
          }),
        ),
        nameField,
        h('label', { class: 'field' }, h('span', null, 'Wind'), select(Object.entries(WIND_STATES) as Array<[WindState, string]>, wind, (v) => (wind = v as WindState))),
        h('label', { class: 'field wide' }, h('span', null, 'Notes'), notes),
      ),
      h('div', { class: 'actions' }, saveBtn, h('button', { type: 'button', class: 'btn', onclick: () => this.reset() }, 'Discard')),
    );
  }
}

function instructions(p: Position): string {
  switch (p) {
    case 'DU':
      return 'Lay the watch flat, dial facing up.';
    case 'DD':
      return 'Turn it over so the dial faces down.';
    case 'CU':
      return 'Stand it on its side with the crown pointing up.';
    case 'CD':
      return 'Stand it with the crown pointing down.';
    case 'CL':
      return 'Stand it with the crown pointing left.';
    case 'CR':
      return 'Stand it with the crown pointing right.';
  }
}
