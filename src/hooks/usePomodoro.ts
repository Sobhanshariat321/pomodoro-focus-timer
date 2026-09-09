import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APP_NAME,
  DEFAULT_SETTINGS,
  PHASE_LABELS,
  formatCountdown,
  loadPersisted,
  nextPhaseAfter,
  nextPhaseOnSkip,
  phaseDurationMs,
  savePersisted,
  type Phase,
  type PomodoroSettings,
  type TimerStatus,
} from '../lib/pomodoro';
import { playChime, unlockAudio } from '../lib/sound';

interface InitialState {
  settings: PomodoroSettings;
  soundOn: boolean;
  completedWork: number;
  phase: Phase;
  remainingMs: number;
  totalMs: number;
  status: TimerStatus;
  restored: boolean;
}

function getInitialState(): InitialState {
  const fallback: InitialState = {
    settings: DEFAULT_SETTINGS,
    soundOn: true,
    completedWork: 0,
    phase: 'work',
    remainingMs: phaseDurationMs('work', DEFAULT_SETTINGS),
    totalMs: phaseDurationMs('work', DEFAULT_SETTINGS),
    status: 'idle',
    restored: false,
  };
  const persisted = loadPersisted();
  if (!persisted) return fallback;
  const full = phaseDurationMs(persisted.snapshot.phase, persisted.settings);
  if (persisted.snapshot.status === 'paused' && persisted.snapshot.remainingMs < full) {
    return {
      settings: persisted.settings,
      soundOn: persisted.soundOn,
      completedWork: persisted.completedWork,
      phase: persisted.snapshot.phase,
      remainingMs: persisted.snapshot.remainingMs,
      totalMs: full,
      status: 'paused',
      restored: true,
    };
  }
  return {
    settings: persisted.settings,
    soundOn: persisted.soundOn,
    completedWork: persisted.completedWork,
    phase: persisted.snapshot.phase,
    remainingMs: full,
    totalMs: full,
    status: 'idle',
    restored: false,
  };
}

export function usePomodoro() {
  const [initial] = useState<InitialState>(getInitialState);
  const [settings, setSettings] = useState<PomodoroSettings>(initial.settings);
  const [soundOn, setSoundOn] = useState(initial.soundOn);
  const [completedWork, setCompletedWork] = useState(initial.completedWork);
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [status, setStatus] = useState<TimerStatus>(initial.status);
  const [remainingMs, setRemainingMs] = useState(initial.remainingMs);
  const [totalMs, setTotalMs] = useState(initial.totalMs);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>(
    initial.restored
      ? `Restored after reload — press Resume. Paused — ${formatCountdown(initial.remainingMs)} left in ${PHASE_LABELS[initial.phase]}.`
      : `Idle — ${PHASE_LABELS[initial.phase]} ${formatCountdown(initial.remainingMs)} ready.`,
  );

  // Timestamp source of truth while running (FR-30: no drift, tab-safe).
  const deadlineRef = useRef<number>(0);
  // Frozen remaining captured at pause time. `deadlineRef - now` keeps
  // shrinking while paused, so resume must use this frozen value (SOBA-8
  // exact in-session resume, SOBA-9 restored-paused resume after reload).
  // Seeded from the restored snapshot so Resume after reload continues the
  // same phase instead of seeing deadlineRef=0 and spuriously completing.
  const pausedRemainingRef = useRef<number>(
    initial.status === 'paused' ? initial.remainingMs : 0,
  );
  // Transition lock: exactly one transition per completion (E-03, E-11).
  const transitionLockRef = useRef(false);
  // Live mirror for interval callbacks (avoids stale closures).
  const liveRef = useRef({ phase, status, settings, soundOn, completedWork, totalMs, remainingMs });
  liveRef.current = { phase, status, settings, soundOn, completedWork, totalMs, remainingMs };

  const display = formatCountdown(remainingMs);
  const displaySecond = Math.max(0, Math.ceil(remainingMs / 1000));

  const beginRunning = useCallback((ms: number) => {
    transitionLockRef.current = false;
    pausedRemainingRef.current = 0;
    deadlineRef.current = Date.now() + ms;
    setStatus('running');
  }, []);

  /** Natural completion at 00:00 — guarded to fire exactly once. */
  const completePhase = useCallback(() => {
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      const live = liveRef.current;
      const finished = live.phase;
      const finishedLabel = PHASE_LABELS[finished];
      if (finished === 'work') {
        const nextCompleted = live.completedWork + 1;
        const next = nextPhaseAfter('work', nextCompleted, live.settings);
        const nextTotal = phaseDurationMs(next, live.settings);
        setCompletedWork(nextCompleted);
        setPhase(next);
        setTotalMs(nextTotal);
        setRemainingMs(nextTotal);
        beginRunning(nextTotal);
        if (live.soundOn) playChime();
        setAnnouncement(
          next === 'long-break'
            ? `Pomodoro ${nextCompleted} complete — long break started.`
            : `${finishedLabel} complete. Now in ${PHASE_LABELS[next]}.`,
        );
      } else {
        const nextTotal = phaseDurationMs('work', live.settings);
        setPhase('work');
        setTotalMs(nextTotal);
        setRemainingMs(nextTotal);
        beginRunning(nextTotal);
        if (live.soundOn) playChime();
        setAnnouncement(`${finishedLabel} complete. Now in Work.`);
      }
    } finally {
      transitionLockRef.current = false;
    }
  }, [beginRunning]);

  const completeRef = useRef(completePhase);
  completeRef.current = completePhase;

  // Single tick source; cleaned up on every re-run (FR-31).
  useEffect(() => {
    if (status !== 'running') return;
    const id = window.setInterval(() => {
      const rem = deadlineRef.current - Date.now();
      if (rem <= 0) {
        completeRef.current();
      } else {
        setRemainingMs(rem);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [status]);

  // Recompute immediately when the tab becomes visible again (E-01).
  useEffect(() => {
    if (status !== 'running') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const rem = deadlineRef.current - Date.now();
        if (rem <= 0) {
          completeRef.current();
        } else {
          setRemainingMs(rem);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status]);

  const start = useCallback(() => {
    unlockAudio();
    const live = liveRef.current;
    if (live.status === 'running') return;
    const ms =
      live.status === 'paused'
        ? pausedRemainingRef.current > 0
          ? pausedRemainingRef.current
          : live.remainingMs
        : live.totalMs;
    // Remaining could have elapsed while paused in background — complete instead.
    if (ms <= 0) {
      completeRef.current();
      return;
    }
    if (live.status === 'paused') {
      beginRunning(ms);
      setRemainingMs(ms);
      setAnnouncement(`Resumed — ${PHASE_LABELS[live.phase]}.`);
    } else {
      beginRunning(live.totalMs);
      setRemainingMs(live.totalMs);
      setAnnouncement(`Running — ${PHASE_LABELS[live.phase]}.`);
    }
  }, [beginRunning]);

  const pause = useCallback(() => {
    const live = liveRef.current;
    if (live.status !== 'running') return;
    const rem = deadlineRef.current - Date.now();
    if (rem <= 0) {
      completeRef.current();
      return;
    }
    transitionLockRef.current = false;
    pausedRemainingRef.current = rem;
    setRemainingMs(rem);
    setStatus('paused');
    setAnnouncement(
      `Paused — ${formatCountdown(rem)} left in ${PHASE_LABELS[live.phase]}.`,
    );
  }, []);

  const reset = useCallback(() => {
    const live = liveRef.current;
    transitionLockRef.current = false;
    pausedRemainingRef.current = 0;
    const full = phaseDurationMs(live.phase, live.settings);
    setTotalMs(full);
    setRemainingMs(full);
    setStatus('idle');
    setAnnouncement(`Phase reset — ${PHASE_LABELS[live.phase]} ${formatCountdown(full)}.`);
  }, []);

  const skip = useCallback(() => {
    const live = liveRef.current;
    if (live.status === 'idle') return;
    unlockAudio();
    // Phase already elapsed on this frame → completion wins exactly once (E-11).
    if (live.status === 'running' && deadlineRef.current - Date.now() <= 0) {
      completeRef.current();
      return;
    }
    const next = nextPhaseOnSkip(live.phase, live.completedWork, live.settings);
    const nextTotal = phaseDurationMs(next, live.settings);
    const skippedLabel = PHASE_LABELS[live.phase];
    setPhase(next);
    setTotalMs(nextTotal);
    setRemainingMs(nextTotal);
    beginRunning(nextTotal);
    setAnnouncement(`${skippedLabel} skipped. Now in ${PHASE_LABELS[next]}.`);
  }, [beginRunning]);

  const updateSetting = useCallback(
    <K extends keyof PomodoroSettings>(key: K, value: PomodoroSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        const live = liveRef.current;
        if (live.status === 'idle') {
          // Applies immediately while idle (FR-13).
          const full = phaseDurationMs(live.phase, next);
          setTotalMs(full);
          setRemainingMs(full);
          setAnnouncement(
            `Idle — ${PHASE_LABELS[live.phase]} ${formatCountdown(full)} ready.`,
          );
          setSettingsNote(null);
        } else {
          // Future phases only; current phase untouched until Reset.
          setSettingsNote('Applied to upcoming phases.');
        }
        return next;
      });
    },
    [],
  );

  const toggleSound = useCallback(() => {
    unlockAudio();
    setSoundOn((prev) => !prev);
  }, []);

  const resetCounter = useCallback(() => {
    setCompletedWork(0);
    setAnnouncement('Counter reset — 0 completed pomodoros.');
  }, []);

  // Persistence: settings + flag + counter + snapshot (FR-21). Never auto-runs
  // on reload — snapshot always restores paused (FR-22).
  useEffect(() => {
    savePersisted({
      settings,
      soundOn,
      completedWork,
      snapshot: {
        phase,
        remainingMs: Math.max(0, Math.ceil(remainingMs / 1000)) * 1000,
        status: status === 'running' ? 'paused' : status,
      },
    });
  }, [settings, soundOn, completedWork, phase, status, displaySecond]); // eslint-disable-line react-hooks/exhaustive-deps

  // Document title (FR-18, exact design §3.3 format).
  useEffect(() => {
    document.title =
      status === 'idle' ? APP_NAME : `${display} · ${PHASE_LABELS[phase]}`;
  }, [display, phase, status]);

  const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0;

  return {
    settings,
    soundOn,
    completedWork,
    phase,
    status,
    remainingMs,
    totalMs,
    display,
    progress,
    announcement,
    settingsNote,
    isIdle: status === 'idle',
    actions: {
      start,
      pause,
      reset,
      skip,
      updateSetting,
      toggleSound,
      resetCounter,
    },
  };
}

export type PomodoroApi = ReturnType<typeof usePomodoro>;
