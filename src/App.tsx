import { useEffect, useMemo, useRef, useState } from 'react';
import { usePomodoro } from './hooks/usePomodoro';
import {
  LIMITS,
  positionInCycle,
  validateSettingValue,
  type Phase,
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

const PHASE_PILLS: Array<{ value: Phase; label: string }> = [
  { value: 'work', label: 'Focus' },
  { value: 'short-break', label: 'Short Break' },
  { value: 'long-break', label: 'Long Break' },
];

const QUOTES = [
  'Stay with the work in front of you.',
  'Attention is the rarest form of generosity.',
  'One pomodoro at a time.',
  'Begin anywhere; finish somewhere.',
  'Depth rewards the patient.',
  'Make it small, make it now.',
  'Quiet mind, steady hands.',
  'The next twenty-five minutes matter.',
];

const MOTES = 24;

interface Mote {
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
}

function useMotes(): Mote[] {
  return useMemo(
    () =>
      Array.from({ length: MOTES }, (_, i) => {
        // Deterministic pseudo-random from index (offline-safe, stable across renders).
        const seed = (i * 2654435761) % 1000 / 1000;
        const seed2 = ((i + 37) * 40503) % 1000 / 1000;
        const seed3 = ((i + 91) * 65599) % 1000 / 1000;
        return {
          left: seed * 100,
          top: seed2 * 100,
          size: 2 + seed3 * 2,
          duration: 40 + seed * 50,
          delay: -(seed2 * 90),
          drift: 20 + seed3 * 60,
        };
      }),
    [],
  );
}

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

  const motes = useMotes();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusText, setFocusText] = useState('');
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState('');

  const heroRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  const primaryLabel = status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start';
  const primaryAction = status === 'running' ? actions.pause : actions.start;

  const n = settings.pomodorosBeforeLongBreak;
  const position = positionInCycle(completedWork, n);
  const filledDots = completedWork % n;

  // Rotating local quote — purely presentational, rotates on phase change.
  const quoteIndex = useMemo(() => {
    const order: Record<Phase, number> = { work: 0, 'short-break': 3, 'long-break': 5 };
    return (order[phase] + Math.floor(completedWork / Math.max(1, n))) % QUOTES.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, completedWork, n]);
  const quote = QUOTES[quoteIndex];

  // Keyboard shortcuts: Space = Start/Pause/Resume, R = Reset, S = Skip.
  // Ignored while typing in inputs (extends to focus prompt + drawer inputs);
  // native button activation is not hijacked.
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

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Drawer: focus first control on open, return focus to trigger on close.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelector<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [drawerOpen]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    settingsTriggerRef.current?.focus();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const focusHero = () => {
    heroRef.current?.scrollIntoView({ block: 'center' });
    timerRef.current?.focus({ preventScroll: true });
  };

  const commitFocus = (value: string) => {
    const trimmed = value.trim().slice(0, 80);
    setFocusText(trimmed);
    setEditingFocus(false);
  };

  const cancelFocusEdit = () => {
    setFocusDraft(focusText);
    setEditingFocus(false);
  };

  return (
    <div className="stage" data-phase={phase}>
      {/* L0 — photographic cinematic environment (local asset) */}
      <div className="env env-photo" aria-hidden="true" />
      {/* L0b — fallback gradient behind photo */}
      <div className="env env-l0" aria-hidden="true" />

      {/* L2 — grain + drifting dust motes (above photo, below overlays) */}
      <div className="env env-l2" aria-hidden="true">
        <svg className="grain" focusable="false" aria-hidden="true">
          <filter id="grainFilter">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grainFilter)" />
        </svg>
        {motes.map((m, i) => (
          <span
            key={i}
            className="mote"
            style={{
              left: `${m.left}%`,
              top: `${m.top}%`,
              width: `${m.size}px`,
              height: `${m.size}px`,
              animationDuration: `${m.duration}s`,
              animationDelay: `${m.delay}s`,
              ['--drift' as string]: `${m.drift}px`,
            }}
          />
        ))}
      </div>

      {/* L3 — mandatory readability system */}
      <div className="env env-l3" aria-hidden="true">
        <div className="scrim" />
        <div className="spotlight" />
        <div className="vignette" />
        <div className="phase-tint" />
      </div>

      {/* Top bar: brand | focus prompt | quote */}
      <header className="topbar">
        <div className="brand">
          <svg className="brand-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="brandAmber" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f0c078" />
                <stop offset="1" stopColor="#b9743c" />
              </linearGradient>
            </defs>
            <path
              d="M7 3h14c.6 0 1 .4 1 1v2.2c0 3.4-2.6 5-4.6 6.3-1.4.9-2.4 1.6-2.4 2.9v1.2c0 1.3 1 2 2.4 2.9 2 1.3 4.6 2.9 4.6 6.3V27c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1v-1.2c0-3.4 2.6-5 4.6-6.3 1.4-.9 2.4-1.6 2.4-2.9v-1.2c0-1.3-1-2-2.4-2.9C8.6 11.2 6 9.6 6 6.2V4c0-.6.4-1 1-1Z"
              fill="none"
              stroke="url(#brandAmber)"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M9 6.5h10" stroke="url(#brandAmber)" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="14" cy="21.5" r="1.4" fill="url(#brandAmber)" />
          </svg>
          <span className="brand-lockup">
            <span className="brand-name">Pomodoro</span>
            <span className="brand-sub">Focus Timer</span>
          </span>
        </div>

        <div className="prompt-wrap">
          {editingFocus ? (
            <input
              className="prompt-input"
              autoFocus
              value={focusDraft}
              maxLength={80}
              aria-label="Current focus. Activate to edit."
              placeholder="What are you focusing on?"
              onChange={(e) => setFocusDraft(e.target.value.slice(0, 80))}
              onBlur={() => commitFocus(focusDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitFocus((e.target as HTMLInputElement).value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelFocusEdit();
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="prompt-line"
              aria-label="Current focus. Activate to edit."
              title={focusText || 'Set your focus'}
              onClick={() => {
                setFocusDraft(focusText);
                setEditingFocus(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setFocusDraft(focusText);
                  setEditingFocus(true);
                }
              }}
            >
              <span className="prompt-text">{focusText || 'What are you focusing on?'}</span>
              <svg className="prompt-pencil" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
                <path
                  d="M9.8 2.2a1.4 1.4 0 0 1 2 2L5.4 10.6 2.5 11.5l.9-2.9 6.4-6.4Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="prompt-underline" aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="quote" aria-hidden="true">
          <span className="quote-rule" aria-hidden="true" />
          {quote}
        </p>
      </header>

      {/* Hero column */}
      <main className="hero" ref={heroRef}>
        <div
          className="phase-group"
          role="group"
          aria-label="Current phase (follows the timer)"
          title="Phase follows the timer"
        >
          {PHASE_PILLS.map((pill) => (
            <span
              key={pill.value}
              className={`phase-seg${phase === pill.value ? ' is-active' : ''} phase-accent-${pill.value}`}
              aria-current={phase === pill.value ? 'true' : undefined}
              title="Phase follows the timer"
            >
              {pill.label}
            </span>
          ))}
        </div>

        <div
          className="hero-timer"
          key={phase}
          ref={timerRef}
          role="timer"
          aria-label="Time remaining"
          tabIndex={-1}
        >
          {display}
        </div>

        <div className="controls-row">
          <button
            type="button"
            className="btn-ghost-circle"
            title="Restart current phase (R)"
            aria-label="Restart current phase"
            disabled={isIdle}
            onClick={actions.reset}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 2.5v3.6h-3.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="btn-primary-pill" onClick={primaryAction}>
            <span className="btn-primary-label">{primaryLabel}</span>
          </button>
          <button
            type="button"
            className="btn-ghost-circle"
            title="Skip to next phase (S)"
            aria-label="Skip to next phase"
            disabled={isIdle}
            onClick={actions.skip}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 4.5v11l7-5.5-7-5.5Z" fill="currentColor" />
              <rect x="13.4" y="4.5" width="2.2" height="11" rx="1" fill="currentColor" />
            </svg>
          </button>
        </div>
        <p className="hint">Space Start/Pause · R Reset · S Skip</p>

        <div className="progress-wrap">
          <div className="progress-track" aria-hidden="true">
            <div
              className={`progress-fill phase-fill-${phase}`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="dots" aria-hidden="true">
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={i < filledDots ? 'pdot filled' : 'pdot'} />
            ))}
          </div>
        </div>

        <div className="session-strip">
          <span className="session-pill">
            Pomodoro {position} of {n}
          </span>
          <span className="session-pill">Completed: {completedWork}</span>
          <span className="session-pill session-condensed" aria-hidden="true">
            {position}/{n} · ✓{completedWork}
          </span>
        </div>

        <p className="status-line" role="status" aria-live="polite">
          {status === 'running' ? 'Running' : status === 'paused' ? 'Paused' : 'Idle'} — {announcement}
        </p>

        <p className="hero-tagline" aria-hidden="true">
          <span className="hero-tagline-rule" aria-hidden="true" />
          Focus &nbsp;·&nbsp; Better Decisions &nbsp;·&nbsp; A Calmer You
          <span className="hero-tagline-rule" aria-hidden="true" />
        </p>
      </main>

      {/* Slim floating rail (bottom nav on mobile) */}
      <nav className="rail" aria-label="Quick actions">
        <button
          type="button"
          className="rail-btn is-active"
          title="Focus timer"
          aria-label="Focus timer"
          aria-current="true"
          onClick={focusHero}
        >
          <span className="rail-dot" aria-hidden="true" />
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 6v4l2.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="rail-btn"
          title={soundOn ? 'Mute sound' : 'Unmute sound'}
          aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
          aria-pressed={soundOn}
          onClick={actions.toggleSound}
        >
          {soundOn ? (
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M3 7.5v5h3l4 3.5v-12L6 7.5H3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M3 7.5v5h3l4 3.5v-12L6 7.5H3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M13.5 7.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="rail-btn"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-pressed={isFullscreen}
          onClick={toggleFullscreen}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M3.5 7V3.5H7M13 3.5h3.5V7M16.5 13v3.5H13M7 16.5H3.5V13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="rail-btn"
          ref={settingsTriggerRef}
          title="Settings"
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M10 2.5v2.4M10 15.1v2.4M2.5 10h2.4M15.1 10h2.4M4.7 4.7l1.7 1.7M13.6 13.6l1.7 1.7M15.3 4.7l-1.7 1.7M6.4 13.6l-1.7 1.7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </nav>

      {/* Settings drawer */}
      {drawerOpen && (
        <div className="drawer-root">
          <div className="drawer-overlay" aria-hidden="true" onClick={closeDrawer} />
          <aside
            className="drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-heading"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                closeDrawer();
                return;
              }
              if (e.key === 'Tab') {
                const drawer = drawerRef.current;
                if (!drawer) return;
                const items = Array.from(
                  drawer.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
                  ),
                ).filter((el) => el.offsetParent !== null || el === document.activeElement);
                if (items.length === 0) return;
                const first = items[0];
                const last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="drawer-handle" aria-hidden="true" />
            <div className="drawer-head">
              <h2 id="settings-heading">Settings</h2>
              <button type="button" className="drawer-close" aria-label="Close settings" onClick={closeDrawer}>
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <SettingsForm
              settings={settings}
              soundOn={soundOn}
              settingsNote={settingsNote}
              onUpdate={actions.updateSetting}
              onToggleSound={actions.toggleSound}
              onResetCounter={actions.resetCounter}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

interface SettingsFormProps {
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

function SettingsForm({
  settings,
  soundOn,
  settingsNote,
  onUpdate,
  onToggleSound,
  onResetCounter,
}: SettingsFormProps) {
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

  const disarmCounter = () => {
    if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    setCounterArmed(false);
  };

  const handleCounterReset = () => {
    if (!counterArmed) {
      setCounterArmed(true);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setCounterArmed(false), 5000);
      return;
    }
    disarmCounter();
    onResetCounter();
  };

  return (
    <div className="drawer-body">
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
        <button
          type="button"
          id="setting-sound-toggle"
          role="switch"
          aria-checked={soundOn}
          aria-labelledby="setting-sound-label"
          className={`switch${soundOn ? ' is-on' : ''}`}
          onClick={onToggleSound}
        >
          <span className="switch-knob" aria-hidden="true" />
        </button>
        <span id="setting-sound-label">Sound on</span>
        <button
          type="button"
          className="btn-drawer-ghost"
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
        className="btn-drawer-danger"
        onClick={handleCounterReset}
        onBlur={() => setCounterArmed(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setCounterArmed(false);
        }}
      >
        {counterArmed ? 'Press again to confirm' : 'Reset counter'}
      </button>

      <p className="helper">Changes apply to future phases. The current phase keeps its time until you press Reset.</p>
      {settingsNote && (
        <p className="helper helper-note" role="status">
          {settingsNote}
        </p>
      )}
    </div>
  );
}
