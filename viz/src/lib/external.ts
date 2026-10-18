import { usePlaybackStore } from '../store';
import type { Scenario } from '../types';

export function listenForExternalControl(): () => void {
  let replayId: string | null = null;
  let version = -1;
  function onMessage(event: MessageEvent) {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'harbour-watch' || typeof msg.replayId !== 'string'
      || !Number.isSafeInteger(msg.version) || msg.version < 0) return;
    if (msg.type === 'reset') {
      replayId = msg.replayId;
      version = -1;
      usePlaybackStore.getState().clearScenario();
      return;
    }
    if (msg.replayId !== replayId) return;
    if (msg.type === 'scenario') {
      if (!msg.scenario || msg.version <= version) return;
      const store = usePlaybackStore.getState();
      if (store.scenario) store.updateScenario(msg.scenario as Scenario);
      else store.loadScenario(msg.scenario as Scenario);
      version = msg.version;
    } else if (msg.type === 'focus-alert') {
      usePlaybackStore.getState().flyToAlertOverview();
      return;
    } else if (msg.type !== 'sync') return;
    const store = usePlaybackStore.getState();
    if (typeof msg.speed === 'number' && Number.isFinite(msg.speed) && msg.speed > 0) store.setSpeedMultiplier(msg.speed);
    if (typeof msg.t === 'number' && Number.isFinite(msg.t)) store.syncExternalClock(msg.t, Boolean(msg.playing));
  }
  window.addEventListener('message', onMessage);
  window.parent.postMessage({ source: 'harbour-viz', type: 'ready' }, window.location.origin);
  return () => window.removeEventListener('message', onMessage);
}
