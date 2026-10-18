import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import Controls from './hud/Controls';
import Credits from './hud/Credits';
import ThreatCard from './hud/ThreatCard';
import ActionLog from './hud/ActionLog';
import HandoffBanner from './hud/HandoffBanner';
import IncidentReport from './hud/IncidentReport';
import Countdown from './hud/Countdown';
import Masthead from './hud/Masthead';
import InfoCard from './hud/InfoCard';
import Environment from './scene/Environment';
import PostFX from './scene/fx/PostFX';
import SurfaceBoats from './scene/SurfaceBoats';
import DroneBoat from './scene/DroneBoat';
import Intruder from './scene/Intruder';
import Hydrophones from './scene/Hydrophones';
import BearingLines from './scene/BearingLines';
import CameraDirector from './scene/CameraDirector';
import ProtectedZones from './scene/ProtectedZones';
import ReachRings from './scene/ReachRings';
import WaterAtmosphere from './scene/WaterAtmosphere';
import FishCloud from './scene/FishCloud';
import { usePlaybackStore } from './store';
import { preloadTextures } from './lib/textures';
import { COLORS, TEXTURES } from './theme';
import type { Scenario } from './types';
import { isExternal, listenForExternalControl } from './lib/external';

const appColors = {
  '--color-background': COLORS.background,
  '--color-paper': COLORS.paper,
  '--color-ink': COLORS.ink,
  '--color-line': COLORS.line,
  '--color-shallow-water': COLORS.shallowWater,
  '--color-underwater-fog': COLORS.underwaterFog,
  '--color-neutral': COLORS.neutral,
  '--color-acoustic': COLORS.acoustic,
  '--color-automatic': COLORS.automatic,
  '--color-approval': COLORS.approval,
  '--color-protected-zone': COLORS.protectedZone,
} as CSSProperties;

function Clock() {
  const advance = usePlaybackStore((state) => state.advance);
  useFrame((_, delta) => advance(delta));
  return null;
}

export default function App() {
  const tintRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState('');
  const [texturesReady, setTexturesReady] = useState(false);
  const loadScenario = usePlaybackStore((state) => state.loadScenario);
  const openingShot = usePlaybackStore((state) => state.scenario?.camera[0]);
  const hudVisible = usePlaybackStore((state) => state.hudVisible);

  useEffect(() => {
    if (isExternal()) return listenForExternalControl();  // scenario and clock come from the dashboard
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
    preloadTextures([
      { url: TEXTURES.sand },
      { url: TEXTURES.caustics, color: false },
    ]).then(() => setTexturesReady(true));
  }, []);

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

      if (event.code === 'Escape') {
        store.backToDirector();
      } else if (event.code === 'Space') {
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
      {openingShot && texturesReady && (
        <Canvas
          className="scene"
          flat
          dpr={[1, 2]}
          camera={{ position: openingShot.pos, fov: 40, near: 1, far: 6000 }}
        >
          <Environment />
          <SurfaceBoats />
          <DroneBoat />
          <Intruder />
          <Hydrophones />
          <BearingLines />
          <ProtectedZones />
          <ReachRings />
          <FishCloud />
          <PostFX />
          <Clock />
          <CameraDirector />
          <WaterAtmosphere tintRef={tintRef} />
        </Canvas>
      )}

      <div className="underwater-tint" ref={tintRef} aria-hidden="true" />

      {hudVisible && (
        <div className="hud" aria-label="Demo interface">
          <Masthead />
          {loadError ? <div className="hud-panel threat-card hud-error" role="alert">{loadError}</div> : <ThreatCard />}
          <HandoffBanner />
          <Countdown />
          <ActionLog />
          <IncidentReport />
          <InfoCard />
          {!isExternal() && <Controls />}
        </div>
      )}
      <div className="paper-grain" aria-hidden="true" />
      <Credits />
    </div>
  );
}
