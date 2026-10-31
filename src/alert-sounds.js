
(function () {
  'use strict';

  if (window.ISA_ALERT_SOUNDS) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  const PRESETS = {
    'blink-blink': {
      label: 'Blink-blink (default)',
      notes: [
        { freq: 1047, at: 0.00, dur: 0.07, type: 'triangle', peak: 0.15 },
        { freq: 1319, at: 0.10, dur: 0.09, type: 'triangle', peak: 0.15 }
      ]
    },
    tritone: {
      label: 'Tri-tone',
      notes: [
        { freq: 660, at: 0.00, dur: 0.14, type: 'triangle', peak: 0.16 },
        { freq: 988, at: 0.12, dur: 0.20, type: 'triangle', peak: 0.16 }
      ]
    },
    marimba: {
      label: 'Marimba',
      notes: [
        { freq: 784, at: 0.00, dur: 0.30, type: 'sine', peak: 0.18 },
        { freq: 1568, at: 0.00, dur: 0.14, type: 'sine', peak: 0.05 }
      ]
    },
    'soft-ping': {
      label: 'Soft ping',
      notes: [
        { freq: 880, at: 0.00, dur: 0.20, type: 'sine', peak: 0.16 }
      ]
    },
    'rising-chime': {
      label: 'Rising chime',
      notes: [
        { freq: 523, at: 0.00, dur: 0.12, type: 'sine', peak: 0.14 },
        { freq: 659, at: 0.10, dur: 0.12, type: 'sine', peak: 0.14 },
        { freq: 784, at: 0.20, dur: 0.22, type: 'sine', peak: 0.14 }
      ]
    },
    'double-knock': {
      label: 'Double knock',
      notes: [
        { freq: 420, at: 0.00, dur: 0.09, type: 'triangle', peak: 0.18 },
        { freq: 420, at: 0.13, dur: 0.09, type: 'triangle', peak: 0.18 }
      ]
    },
    silent: {
      label: 'Silent (no sound)',
      notes: []
    }
  };

  const PRESET_ORDER = ['blink-blink', 'tritone', 'marimba', 'soft-ping', 'rising-chime', 'double-knock', 'silent'];
  const DEFAULT_ID = 'blink-blink';

  const MASTER_GAIN = 5;
  const MAX_PEAK = 0.9;

  let sharedContext = null;
  let userGestured = false;

  function transientlyActive() {
    try {
      const activation = navigator.userActivation;
      if (activation && typeof activation.isActive === 'boolean') {
        return activation.isActive;
      }
    } catch (error) {}
    return userGestured;
  }

  function inActivatingGesture(event) {
    try {
      const activation = navigator.userActivation;
      if (activation && typeof activation.isActive === 'boolean') {
        return activation.isActive;
      }
    } catch (error) {}
    return !!event && event.isTrusted !== false;
  }

  function getContext(allowCreate) {
    if (!AudioContextClass) return null;
    if (!sharedContext) {
      if (!allowCreate) return null;
      try {
        sharedContext = new AudioContextClass();
      } catch (error) {
        return null;
      }
    }
    return sharedContext;
  }

  function resumeContext(ctx) {
    if (!ctx || ctx.state !== 'suspended' || typeof ctx.resume !== 'function') return;
    if (!transientlyActive()) return;
    ctx.resume().catch(() => {});
  }

  function playNote(ctx, note, baseTime) {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const start = baseTime + (note.at || 0);
    const peak = Math.min((note.peak || 0.15) * MASTER_GAIN, MAX_PEAK);
    const dur = note.dur || 0.15;

    oscillator.type = note.type || 'sine';
    oscillator.frequency.setValueAtTime(note.freq, start);

    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(peak, start + 0.004);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    oscillator.connect(gainNode).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + dur + 0.02);
  }

  function play(id) {
    const preset = PRESETS[id] || PRESETS[DEFAULT_ID];
    if (!preset || !preset.notes || !preset.notes.length) return;

    const ctx = getContext(false);
    if (!ctx || ctx.state !== 'running') return;

    try {
      const base = ctx.currentTime + 0.01;
      preset.notes.forEach((note) => playNote(ctx, note, base));
    } catch (error) {
    }
  }

  const GESTURE_EVENTS = ['pointerdown', 'keydown'];

  function onFirstGesture(event) {
    if (!inActivatingGesture(event)) return;
    userGestured = true;
    resumeContext(getContext(true));
    GESTURE_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, onFirstGesture, true);
    });
  }

  if (typeof window.addEventListener === 'function') {
    GESTURE_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, onFirstGesture, { capture: true });
    });
  }

  window.ISA_ALERT_SOUNDS = {
    presets: PRESET_ORDER.map((id) => ({ id, label: PRESETS[id].label })),
    defaultId: DEFAULT_ID,
    play
  };
})();
