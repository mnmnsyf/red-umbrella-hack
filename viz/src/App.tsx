import { useEffect, useState, type CSSProperties } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import Controls from './hud/Controls';
import PhaseBar from './hud/PhaseBar';
import ActionLog from './hud/ActionLog';
import HandoffBanner from './hud/HandoffBanner';
import EndCard from './hud/EndCard';
import Environment from './scene/Environment';
import PostFX from './scene/fx/PostFX';
import SurfaceBoats from './scene/SurfaceBoats';
import DroneBoat from './scene/DroneBoat';
import Intruder from './scene/Intruder';
import Hydrophones from './scene/Hydrophones';
import BearingLines from './scene/BearingLines';
import CameraDirector from './scene/CameraDirector';
import { usePlaybackStore } from './store';
import { COLORS } from './theme';
import type { Scenario } from './types';

const appColors = {
  '--color-background': COLORS.background,
  '--color-shallow-water': COLORS.shallowWater,
  '--color-neutral': COLORS.neutral,
  '--color-acoustic': COLORS.acoustic,
  '--color-automatic': COLORS.automatic,
  '--color-approval': COLORS.approval,
} as CSSProperties;

function Clock() {
  const advance = usePlaybackStore((state) => state.advance);
  useFrame((_, delta) => advance(delta));
  return null;
}

export default function App() {
  const [loadError, setLoadError] = useState('');
  const loadScenario = usePlaybackStore((state) => state.loadScenario);
  const openingShot = usePlaybackStore((state) => state.scenario?.camera[0]);
  const hudVisible = usePlaybackStore((state) => state.hudVisible);

  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get('scenario') || 'intrusion';
    if (!/^[a-z0-9-]+$/.test(name)) {
      setLoadError('Invalid scenario name');
      return;
    }

    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}scenarios/${name}.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load scenario: ${name}`);
        return response.json() as Promise<Scenario>;
      })
      .then(loadScenario)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Could not load scenario');
        }
      });

    return () => controller.abort();
  }, [loadScenario]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;

      const store = usePlaybackStore.getState();
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        store.seek(event.code === 'ArrowLeft' ? -5 : 5);
        return;
      }
      if (event.repeat) return;

      if (event.code === 'Space') {
        event.preventDefault();
        store.togglePlaying();
      } else if (event.code === 'KeyR') {
        store.restart();
      } else if (event.code === 'KeyH') {
        store.toggleHud();
      } else if (event.code === 'KeyF') {
        store.toggleFreeCamera();
      } else if (/^Digit[1-9]$/.test(event.code)) {
        store.jumpToAct(Number(event.code.slice(-1)));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app" style={appColors}>
      {openingShot && (
        <Canvas
          className="scene"
          camera={{ position: openingShot.pos, fov: 45, near: 1, far: 4000 }}
        >
          <color attach="background" args={[COLORS.background]} />
          <Environment />
          <SurfaceBoats />
          <DroneBoat />
          <Intruder />
          <Hydrophones />
          <BearingLines />
          <PostFX />
          <Clock />
          <CameraDirector />
        </Canvas>
      )}

      {hudVisible && (
        <div className="hud" aria-label="Demo interface">
          {loadError ? <div className="hud-panel phase-bar hud-error" role="alert">{loadError}</div> : <PhaseBar />}
          <HandoffBanner />
          <ActionLog />
          <EndCard />
          <Controls />
        </div>
      )}
    </div>
  );
}
