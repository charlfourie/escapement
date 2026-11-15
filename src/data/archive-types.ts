/** A Watch Movements Archive entry as stored in archive.json (see scripts/import-archive.ts). */
export interface ArchiveRec {
  /** Archive page slug. */
  s: string;
  /** Title, e.g. "Bulova 11DO = Caravelle 11DO = Citizen 0240". */
  n: string;
  /** Maker / brand. */
  m: string;
  /** Caliber. */
  c: string;
  /** Movement type. */
  t: 'manual' | 'automatic' | 'quartz';
  /** Beat rate, if known. */
  b: number | null;
  /** Beat rate is the archive's best guess. */
  bq?: 1;
  /** Frequency for tuning-fork and quartz movements (not bph). */
  hz?: string;
  /** Escapement: lever, cylinder, pin lever, tuning fork. */
  e: 'lever' | 'cylinder' | 'pin' | 'fork' | '';
  /** Jewels, as listed ("17", "15, 17"). */
  j?: string;
  /** Power reserve, hours. */
  pr?: number;
  /** Size in French lignes, as listed. */
  l?: string;
  /** Largest dimension, mm (from lignes). */
  mm?: number;
  /** Production period ("1974+", "c. 1928"). */
  y?: string;
  co?: string;
  /** Seconds: s small, c centre, j jumping centre. */
  sec?: 's' | 'c' | 'j';
  /** Calendar ("Date", "Date & Day"). */
  dt?: string;
  /** Other functions (chronograph, alarm...). */
  f?: string;
  /** How to identify it ("Rotor marked with CITIZEN 8200."). */
  id?: string;
  /** Contributor credit. */
  by: string;
}

