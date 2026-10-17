import { usePlaybackStore } from '../store';
import type { Phase } from '../types';

const PHASES: Exclude<Phase, 'NONE'>[] = ['DETECT', 'LOCATE', 'INSPECT', 'HANDOFF'];

export default function PhaseBar() {
  const scenario = usePlaybackStore((state) => state.scenario);
  const t = usePlaybackStore((state) => state.t);

  const currentPhase = scenario?.events
    .filter((event) => event.type === 'phase' && event.t <= t)
    .sort((a, b) => b.t - a.t)[0];
  const currentIndex = currentPhase?.type === 'phase' ? PHASES.indexOf(currentPhase.phase as Exclude<Phase, 'NONE'>) : -1;

  return (
    <nav className="hud-panel phase-bar" aria-label="Response phases">
      {PHASES.map((phase, index) => {
        const status = index < currentIndex ? 'past' : index === currentIndex ? 'current' : 'future';
        return (
          <div key={phase} className={`phase-step ${status}`} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="phase-check" aria-hidden="true">{status === 'past' ? '✓' : ''}</span>
            <span>{phase}</span>
          </div>
        );
      })}
    </nav>
  );
}
