import { usePlaybackStore } from '../store';
import type { Scenario } from '../types';

/**
 * External control (used when the viz is embedded next to the Harbour Acoustic Watch dashboard).
 * Open with `?external=1`: instead of loading a scenario file, the viz waits for messages from its
 * same-origin parent window, which sends the scenario of the live incident and its feed clock.
 *
 *   { source: 'harbour-watch', type: 'scenario', scenario, t, speed, playing }  replace the scenario
 *   { source: 'harbour-watch', type: 'sync', t, speed, playing }                follow the clock
 */
export function isExternal(): boolean {
  return new URLSearchParams(window.location.search).has('external');
}

const DRIFT_S = 1.5;  // feed seconds; the dashboard clock arrives in small steps, so tolerate a little drift

export function listenForExternalControl(): () => void {
  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'harbour-watch') return;
    if (msg.type === 'scenario' && msg.scenario) {
      usePlaybackStore.getState().loadScenario(msg.scenario as Scenario);
    }
    if (msg.type !== 'scenario' && msg.type !== 'sync') return;
    const store = usePlaybackStore.getState();
    if (typeof msg.speed === 'number' && msg.speed !== store.speedMultiplier) store.setSpeedMultiplier(msg.speed);
    if (typeof msg.t === 'number' && (msg.type === 'scenario' || Math.abs(store.t - msg.t) > DRIFT_S)) store.seekTo(msg.t);
    const now = usePlaybackStore.getState();
    if (Boolean(msg.playing) !== now.playing) now.togglePlaying();
  }
  window.addEventListener('message', onMessage);
  window.parent?.postMessage({ source: 'harbour-viz', type: 'ready' }, window.location.origin);
  return () => window.removeEventListener('message', onMessage);
}
