import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { usePlaybackStore } from '../store';
import type { Phase } from '../types';

const PHASE_NAMES: Record<Exclude<Phase, 'NONE'>, string> = {
  DETECT: 'Detect',
  LOCATE: 'Locate',
  INSPECT: 'Inspect',
  HANDOFF: 'Handoff',
};

function formatTime(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export default function Controls() {
  const drag = useRef<{ pointerId: number; wasPlaying: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const playing = usePlaybackStore((state) => state.playing);
  const currentAct = usePlaybackStore((state) => state.currentAct);
  const speedMultiplier = usePlaybackStore((state) => state.speedMultiplier);
  const togglePlaying = usePlaybackStore((state) => state.togglePlaying);
  const restart = usePlaybackStore((state) => state.restart);
  const jumpToAct = usePlaybackStore((state) => state.jumpToAct);
  const seekTo = usePlaybackStore((state) => state.seekTo);
  const setSpeedMultiplier = usePlaybackStore((state) => state.setSpeedMultiplier);

  const duration = scenario?.duration ?? 1;
  const percent = (time: number) => `${Math.min(100, Math.max(0, (time / duration) * 100))}%`;
  const phases = scenario?.events.flatMap((event) =>
    event.type === 'phase' && event.phase !== 'NONE' ? [{ t: event.t, phase: event.phase }] : [],
  ) ?? [];
  const currentIndex = phases.reduce((found, phase, index) => (phase.t <= t ? index : found), -1);
  const alertAt = scenario?.events.find((event) => event.type === 'label')?.t;

  function scrubAt(clientX: number, track: HTMLDivElement) {
    if (!scenario) return;
    const bounds = track.getBoundingClientRect();
    if (bounds.width > 0) seekTo(((clientX - bounds.left) / bounds.width) * scenario.duration);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const store = usePlaybackStore.getState();
    if (active.wasPlaying && !store.playing && store.scenario && store.t < store.scenario.duration) {
      store.togglePlaying();
    }
  }

  function onSliderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!scenario) return;
    const now = usePlaybackStore.getState().t;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = now - (event.shiftKey ? 5 : 1); break;
      case 'ArrowRight': next = now + (event.shiftKey ? 5 : 1); break;
      case 'PageDown': next = now - 10; break;
      case 'PageUp': next = now + 10; break;
      case 'Home': next = 0; break;
      case 'End': next = scenario.duration; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    seekTo(next);
  }

  return (
    <div className="hud-panel controls-panel" aria-label="Playback controls">
      <button type="button" className="primary" onClick={togglePlaying} disabled={!scenario || t >= scenario.duration}>
        {playing ? 'Pause' : 'Play'}
      </button>

      <div className="timeline" aria-label="Response phases">
        <div className="timeline-phases">
          {phases.map((phase, index) => (
            <span
              key={phase.phase}
              className={index < currentIndex ? 'past' : index === currentIndex ? 'current' : ''}
              style={{ left: `${((index + 0.5) / phases.length) * 100}%` }}
            >
              {index < currentIndex ? '✓ ' : ''}{PHASE_NAMES[phase.phase]}
            </span>
          ))}
        </div>
        <div
          className={`timeline-track${dragging ? ' dragging' : ''}`}
          role="slider"
          tabIndex={scenario ? 0 : -1}
          aria-label="Playback time"
          aria-disabled={!scenario}
          aria-valuemin={0}
          aria-valuemax={scenario?.duration ?? 0}
          aria-valuenow={t}
          aria-valuetext={`${formatTime(t)}, ${currentAct?.name ?? 'Loading scenario'} phase`}
          onKeyDown={onSliderKeyDown}
          onPointerDown={(event) => {
            if (!scenario || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
            event.preventDefault();
            const store = usePlaybackStore.getState();
            drag.current = { pointerId: event.pointerId, wasPlaying: store.playing };
            if (store.playing) store.togglePlaying();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            scrubAt(event.clientX, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId === event.pointerId) scrubAt(event.clientX, event.currentTarget);
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) scrubAt(event.clientX, event.currentTarget);
            finishDrag(event);
          }}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
        >
          <div className="timeline-fill" style={{ width: percent(t) }} />
          {alertAt !== undefined && <div className="timeline-alert" style={{ left: percent(alertAt) }} />}
          <div className="timeline-knob" style={{ left: percent(t) }} />
        </div>
      </div>

      <div className="controls-group acts" aria-label="Acts">
        {scenario?.acts.map((act) => (
          <button
            key={act.id}
            type="button"
            className={currentAct?.id === act.id ? 'active' : ''}
            aria-label={`Jump to act ${act.id}: ${act.name}`}
            aria-pressed={currentAct?.id === act.id}
            onClick={() => jumpToAct(act.id)}
          >
            {act.id}
          </button>
        ))}
      </div>

      <div className="controls-group" aria-label="Playback speed">
        {[0.5, 1, 2].map((speed) => (
          <button
            key={speed}
            type="button"
            className={speedMultiplier === speed ? 'active' : ''}
            aria-pressed={speedMultiplier === speed}
            onClick={() => setSpeedMultiplier(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>

      <button type="button" onClick={restart} disabled={!scenario} aria-label="Restart">↺</button>

      <div className="controls-status" aria-live="off">
        <strong>{formatTime(t)}</strong>
        <span>{currentAct?.name ?? 'Loading scenario'}</span>
      </div>
    </div>
  );
}
