export type Phase = 'work' | 'short-break' | 'long-break';
export type TimerStatus = 'idle' | 'running' | 'paused';

export interface PomodoroSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodorosBeforeLongBreak: number;
}

export const DEFAULT_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodorosBeforeLongBreak: 4,
};

export const LIMITS = {
  workMinutes: { min: 1, max: 120 },
  shortBreakMinutes: { min: 1, max: 120 },
  longBreakMinutes: { min: 1, max: 120 },
  pomodorosBeforeLongBreak: { min: 2, max: 8 },
} as const;

export type SettingsKey = keyof PomodoroSettings;

export const STORAGE_KEY = 'pomodoro-focus-timer:v1';
export const APP_NAME = 'Pomodoro Focus Timer';

export const PHASE_LABELS: Record<Phase, string> = {
  work: 'Work',
  'short-break': 'Short break',
  'long-break': 'Long break',
};

export function phaseDurationMinutes(phase: Phase, settings: PomodoroSettings): number {
  switch (phase) {
    case 'work':
      return settings.workMinutes;
    case 'short-break':
      return settings.shortBreakMinutes;
    case 'long-break':
      return settings.longBreakMinutes;
  }
}

export function phaseDurationMs(phase: Phase, settings: PomodoroSettings): number {
  return phaseDurationMinutes(phase, settings) * 60 * 1000;
}

/** Next phase after `phase` completes naturally, per FR-08. */
export function nextPhaseAfter(
  finished: Phase,
  completedWork: number,
  settings: PomodoroSettings,
): Phase {
  if (finished === 'work') {
    return completedWork % settings.pomodorosBeforeLongBreak === 0 ? 'long-break' : 'short-break';
  }
  return 'work';
}

/** Next phase after a manual skip (same sequence, no counter change). */
export function nextPhaseOnSkip(
  current: Phase,
  completedWork: number,
  settings: PomodoroSettings,
): Phase {
  if (current === 'work') {
    // Skipping work does not increment the counter; peek at what the
    // *next* natural completion would trigger.
    const hypothetical = completedWork + 1;
    return hypothetical % settings.pomodorosBeforeLongBreak === 0 ? 'long-break' : 'short-break';
  }
  return 'work';
}

/** Position within the current cycle, 1-based (design §3.1). */
export function positionInCycle(completedWork: number, n: number): number {
  return (completedWork % n) + 1;
}

/** MM:SS with MM zero-padded to ≥2 digits; supports up to 120:00. */
export function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function validateSettingValue(key: SettingsKey, raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const limits = LIMITS[key];
  const isSessions = key === 'pomodorosBeforeLongBreak';
  if (raw.trim() === '') {
    return { ok: false, error: isSessions ? 'Enter 2–8 sessions.' : 'Enter 1–120 minutes.' };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < limits.min || num > limits.max) {
    return { ok: false, error: isSessions ? 'Enter 2–8 sessions.' : 'Enter 1–120 minutes.' };
  }
  return { ok: true, value: num };
}

export function isValidSettings(value: unknown): value is PomodoroSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (Object.keys(LIMITS) as SettingsKey[]).every((key) => {
      const n = v[key];
      const { min, max } = LIMITS[key];
      return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
    })
  );
}

interface PersistedSnapshot {
  phase: Phase;
  remainingMs: number;
  status: 'idle' | 'paused';
}

export interface PersistedState {
  settings: PomodoroSettings;
  soundOn: boolean;
  completedWork: number;
  snapshot: PersistedSnapshot;
}

export function sanitizePersisted(raw: unknown): PersistedState | null {
  try {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!isValidSettings(r.settings)) return null;
    const settings = r.settings;
    const soundOn = typeof r.soundOn === 'boolean' ? r.soundOn : true;
    const completedWork =
      typeof r.completedWork === 'number' &&
      Number.isInteger(r.completedWork) &&
      r.completedWork >= 0 &&
      r.completedWork <= 100000
        ? r.completedWork
        : 0;
    const snap = r.snapshot as Partial<PersistedSnapshot> | undefined;
    const phase: Phase =
      snap?.phase === 'work' || snap?.phase === 'short-break' || snap?.phase === 'long-break'
        ? snap.phase
        : 'work';
    const full = phaseDurationMs(phase, settings);
    const remainingMs =
      typeof snap?.remainingMs === 'number' &&
      Number.isFinite(snap.remainingMs) &&
      snap.remainingMs > 0 &&
      snap.remainingMs <= full
        ? snap.remainingMs
        : full;
    const status: 'idle' | 'paused' = snap?.status === 'paused' ? 'paused' : 'idle';
    return { settings, soundOn, completedWork, snapshot: { phase, remainingMs, status } };
  } catch {
    return null;
  }
}

export function loadPersisted(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizePersisted(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function savePersisted(state: PersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-mode denial etc. — app stays usable without persistence.
  }
}
