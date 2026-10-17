import { usePlaybackStore } from '../store';
import { TEXTURES } from '../theme';

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export default function Masthead() {
  const title = usePlaybackStore((state) => state.scenario?.title);
  const t = usePlaybackStore((state) => state.t);

  return (
    <header className="hud-panel masthead">
      <img className="masthead-icon" src={TEXTURES.insignia} alt="" />
      <div>
        <h1>Harbour Acoustic Watch</h1>
        <p>3D situation view · {title ?? 'Loading scenario'}</p>
      </div>
      <div className="masthead-meta">
        <span className="sim-chip">Simulated data</span>
        <div className="feed-time">
          <span className="label">Feed time</span>
          <strong>{formatTime(t)}</strong>
        </div>
      </div>
    </header>
  );
}
