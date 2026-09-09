import { useEffect, useRef, useState } from 'react';
import { usePomodoro } from './hooks/usePomodoro';
import {
  LIMITS,
  PHASE_LABELS,
  positionInCycle,
  validateSettingValue,
  type SettingsKey,
} from './lib/pomodoro';
import { playChime, unlockAudio } from './lib/sound';

const SETTING_FIELDS: Array<{
  key: SettingsKey;
  label: string;
  suffix: string | null;
  inputId: string;
}> = [
  { key: 'workMinutes', label: 'Work duration', suffix: 'min', inputId: 'setting-work' },
  { key: 'shortBreakMinutes', label: 'Short break', suffix: 'min', inputId: 'setting-short' },
  { key: 'longBreakMinutes', label: 'Long break', suffix: 'min', inputId: 'setting-long' },
  {
    key: 'pomodorosBeforeLongBreak',
    label: 'Pomodoros before long break',
    suffix: 'sessions',
    inputId: 'setting-count',
  },
];

export default function App() {
  const {
    settings,
    soundOn,
    completedWork,
    phase,
    status,
    display,
    progress,
    announcement,
    settingsNote,
    isIdle,
    actions,
  } = usePomodoro();

  const primaryLabel = status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start';
  const primaryAction = status === 'running' ? actions.pause : actions.start;

  // Keyboard shortcuts: Space = Start/Pause/Resume, R = Reset, S = Skip.
  // Ignored while typing in inputs; native button activation is not hijacked.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        // If focus is on a button, native Space already activates it — skip to
        // avoid a double toggle.
        if (target && target.tagName === 'BUTTON') return;
        e.preventDefault();
        (status === 'running' ? actions.pause : actions.start)();
      } else if (e.code === 'KeyR') {
        actions.reset();
      } else if (e.code === 'KeyS') {
        actions.skip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status, actions]);

  const n = settings.pomodorosBeforeLongBreak;
  const position = positionInCycle(completedWork, n);
  const filledDots = completedWork % n;

  return (
    <div className="page">
      <header className="site-header">
        <span className="wordmark">Pomodoro Focus Timer</span>
        <span className={`phase-pill phase-${phase}`} aria-hidden="true">
          <span className="dot" />
          {PHASE_LABELS[phase]}
        </span>
      </header>

      <main className="layout">
        <section className="timer-card" aria-label="Timer">
          <div className="timer-top">
            <span className={`phase-pill phase-${phase}`}>
              <span className="dot" />
              {PHASE_LABELS[phase]}
            </span>
            <span className="cycle-line">
              Pomodoro {position} of {n} · Completed: {completedWork}
            </span>
          </div>

          <div className="countdown" role="timer" aria-label="Time remaining">
            {display}
          </div>

          <div
            className="progress-track"
            aria-hidden="true"
          >
            <div
              className={`progress-fill phase-bg-${phase}`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          <div className="dots" aria-hidden="true">
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={i < filledDots ? 'cycle-dot filled' : 'cycle-dot'} />
            ))}
          </div>
          <p className="counter-line">Completed pomodoros: {completedWork}</p>

          <div className="controls">
            <button
              type="button"
              className="btn btn-primary"
              onClick={primaryAction}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              title="Restart current phase"
              disabled={isIdle}
              onClick={actions.reset}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Skip to next phase"
              disabled={isIdle}
              onClick={actions.skip}
            >
              Skip →
            </button>
          </div>

          <p className="hint">
            Shortcuts: Space = Start/Pause/Resume · R = Reset phase · S = Skip. Ignored
            while typing in settings.
          </p>
          <p className="status-line" role="status" aria-live="polite">
            {status === 'running' ? 'Running' : status === 'paused' ? 'Paused' : 'Idle'} —{' '}
            {announcement}
          </p>
        </section>

        <SettingsPanel
          settings={settings}
          soundOn={soundOn}
          settingsNote={settingsNote}
          onUpdate={actions.updateSetting}
          onToggleSound={actions.toggleSound}
          onResetCounter={actions.resetCounter}
        />
      </main>

      <footer className="site-footer">
        Settings save automatically · Timer pauses on reload.
      </footer>
    </div>
  );
}

interface SettingsPanelProps {
  settings: {
    workMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    pomodorosBeforeLongBreak: number;
  };
  soundOn: boolean;
  settingsNote: string | null;
  onUpdate: <K extends SettingsKey>(key: K, value: number) => void;
  onToggleSound: () => void;
  onResetCounter: () => void;
}

function SettingsPanel({
  settings,
  soundOn,
  settingsNote,
  onUpdate,
  onToggleSound,
  onResetCounter,
}: SettingsPanelProps) {
  const [drafts, setDrafts] = useState<Record<SettingsKey, string>>({
    workMinutes: String(settings.workMinutes),
    shortBreakMinutes: String(settings.shortBreakMinutes),
    longBreakMinutes: String(settings.longBreakMinutes),
    pomodorosBeforeLongBreak: String(settings.pomodorosBeforeLongBreak),
  });
  const [errors, setErrors] = useState<Record<SettingsKey, string | null>>({
    workMinutes: null,
    shortBreakMinutes: null,
    longBreakMinutes: null,
    pomodorosBeforeLongBreak: null,
  });
  const [counterArmed, setCounterArmed] = useState(false);
  const armTimer = useRef<number | null>(null);

  // Keep drafts in sync when settings change from elsewhere (e.g. restore).
  useEffect(() => {
    setDrafts({
      workMinutes: String(settings.workMinutes),
      shortBreakMinutes: String(settings.shortBreakMinutes),
      longBreakMinutes: String(settings.longBreakMinutes),
      pomodorosBeforeLongBreak: String(settings.pomodorosBeforeLongBreak),
    });
  }, [settings]);

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    };
  }, []);

  const commit = (key: SettingsKey, raw: string) => {
    const result = validateSettingValue(key, raw);
    if (result.ok) {
      setErrors((prev) => ({ ...prev, [key]: null }));
      setDrafts((prev) => ({ ...prev, [key]: String(result.value) }));
      onUpdate(key, result.value);
    } else {
      // Rejected: inline error, last valid value retained, timer unaffected.
      setErrors((prev) => ({ ...prev, [key]: result.error }));
      setDrafts((prev) => ({ ...prev, [key]: String(settings[key]) }));
    }
  };

  const handleCounterReset = () => {
    if (!counterArmed) {
      setCounterArmed(true);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setCounterArmed(false), 5000);
      return;
    }
    if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    setCounterArmed(false);
    onResetCounter();
  };

  return (
    <section className="settings-panel" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>

      {SETTING_FIELDS.map(({ key, label, suffix, inputId }) => {
        const errorId = `${inputId}-error`;
        const { min, max } = LIMITS[key];
        return (
          <div className="field" key={key}>
            <label htmlFor={inputId}>{label}</label>
            <div className="field-row">
              <input
                id={inputId}
                type="number"
                min={min}
                max={max}
                step={1}
                value={drafts[key]}
                aria-invalid={errors[key] ? 'true' : undefined}
                aria-describedby={errors[key] ? errorId : undefined}
                onChange={(e) => {
                  setDrafts((prev) => ({ ...prev, [key]: e.target.value }));
                }}
                onBlur={(e) => commit(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commit(key, (e.target as HTMLInputElement).value);
                  }
                }}
              />
              {suffix && <span className="unit">{suffix}</span>}
            </div>
            {errors[key] && (
              <p className="field-error" id={errorId} role="alert">
                {errors[key]}
              </p>
            )}
          </div>
        );
      })}

      <div className="field field-check">
        <input
          id="setting-sound"
          type="checkbox"
          checked={soundOn}
          onChange={onToggleSound}
        />
        <label htmlFor="setting-sound">Sound on</label>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            unlockAudio();
            playChime();
          }}
        >
          Preview
        </button>
      </div>

      <button
        type="button"
        className="btn btn-danger"
        onClick={handleCounterReset}
        onBlur={() => setCounterArmed(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setCounterArmed(false);
        }}
      >
        {counterArmed ? 'Press again to confirm' : 'Reset counter'}
      </button>

      <p className="helper">
        Changes apply to future phases. The current phase keeps its time until you press
        Reset.
      </p>
      {settingsNote && (
        <p className="helper helper-note" role="status">
          {settingsNote}
        </p>
      )}
    </section>
  );
}
