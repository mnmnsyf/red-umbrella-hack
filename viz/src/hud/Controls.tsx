import { usePlaybackStore } from '../store';

function formatTime(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export default function Controls() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);
  const playing = usePlaybackStore((state) => state.playing);
  const currentAct = usePlaybackStore((state) => state.currentAct);
  const speedMultiplier = usePlaybackStore((state) => state.speedMultiplier);
  const togglePlaying = usePlaybackStore((state) => state.togglePlaying);
  const restart = usePlaybackStore((state) => state.restart);
  const jumpToAct = usePlaybackStore((state) => state.jumpToAct);
  const setSpeedMultiplier = usePlaybackStore((state) => state.setSpeedMultiplier);

  return (
    <div className="hud-panel controls-panel" aria-label="Playback controls">
      <button type="button" onClick={togglePlaying} disabled={!scenario || t >= scenario.duration}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={restart} disabled={!scenario}>Restart</button>

      <div className="controls-group" aria-label="Acts">
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

      <div className="controls-status" aria-live="off">
        <strong>{formatTime(t)}</strong>
        <span>{currentAct?.name ?? 'Loading scenario'}</span>
      </div>
    </div>
  );
}
