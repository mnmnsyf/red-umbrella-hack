import { create } from 'zustand';
import type { Act, Scenario } from './types';
import type { Vec3 } from './types';
import { displayPositionOf, INSPECT_DISTANCE } from './scene/selectable';
import { VEXAG } from './theme';

export type SelectableKind = 'hydrophone' | 'contact' | 'drone' | 'ferry' | 'zone';
export interface Selection { kind: SelectableKind; id: string }

const directorView = { selection: null, hovered: null, flyRequest: null, freeCamera: false };

interface PlaybackStore {
  scenario: Scenario | null;
  t: number;
  playing: boolean;
  speedMultiplier: number;
  externalClock: number | null;
  currentAct: Act | null;
  hudVisible: boolean;
  freeCamera: boolean;
  selection: Selection | null;
  hovered: Selection | null;
  flyRequest: { target: Vec3; distance: number; follow: Selection | null; requestedAt: number; position?: Vec3 } | null;
  select: (selection: Selection) => void;
  flyToPoint: (point: Vec3) => void;
  flyToAlertOverview: () => void;
  setHovered: (selection: Selection | null) => void;
  backToDirector: () => void;
  stopFollowing: () => void;
  loadScenario: (scenario: Scenario) => void;
  updateScenario: (scenario: Scenario) => void;
  clearScenario: () => void;
  advance: (delta: number) => void;
  togglePlaying: () => void;
  restart: () => void;
  jumpToAct: (id: number) => void;
  seek: (seconds: number) => void;
  seekTo: (time: number) => void;
  setSpeedMultiplier: (speed: number) => void;
  syncExternalClock: (time: number, playing: boolean) => void;
  toggleHud: () => void;
  toggleFreeCamera: () => void;
}

function actAt(scenario: Scenario, t: number): Act | null {
  return scenario.acts.find((act) => t >= act.start && t < act.end)
    ?? scenario.acts[scenario.acts.length - 1]
    ?? null;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  scenario: null,
  t: 0,
  playing: false,
  speedMultiplier: 1,
  externalClock: null,
  currentAct: null,
  hudVisible: true,
  ...directorView,

  select: (selection) => set((state) => {
    if (!state.scenario) return state;
    const target = displayPositionOf(selection, state.scenario, state.t);
    if (!target) return state;
    return {
      selection,
      freeCamera: true,
      flyRequest: {
        target, distance: INSPECT_DISTANCE[selection.kind], follow: selection,
        requestedAt: Math.max(performance.now(), (state.flyRequest?.requestedAt ?? 0) + 0.001),
      },
    };
  }),
  flyToPoint: (point) => set((state) => ({
    selection: null,
    freeCamera: true,
    flyRequest: {
      target: [...point], distance: 300, follow: null,
      requestedAt: Math.max(performance.now(), (state.flyRequest?.requestedAt ?? 0) + 0.001),
    },
  })),
  flyToAlertOverview: () => set((state) => {
    const scenario = state.scenario;
    if (!scenario?.camera.length) return state;
    const estimate = [...scenario.events].reverse().find((event) => event.type === 'estimate' && event.t <= state.t);
    const radius = estimate?.type === 'estimate' && Number.isFinite(estimate.radius) && estimate.radius > 0 ? estimate.radius : null;
    const shot = scenario.camera[0];
    const target: Vec3 = radius && estimate?.type === 'estimate' ? [estimate.pos[0], estimate.pos[1] * VEXAG, estimate.pos[2]] : [...shot.target];
    const distance = radius ? Math.max(300, radius * 2.8) : Math.hypot(shot.pos[0] - shot.target[0], shot.pos[1] - shot.target[1], shot.pos[2] - shot.target[2]);
    const position: Vec3 = radius ? [target[0], target[1] + distance * 0.7, target[2] + distance * 0.9] : [...shot.pos];
    return {
      selection: null,
      hovered: null,
      freeCamera: true,
      flyRequest: {
        target, position, distance,
        follow: null,
        requestedAt: Math.max(performance.now(), (state.flyRequest?.requestedAt ?? 0) + 0.001),
      },
    };
  }),
  setHovered: (hovered) => set({ hovered }),
  backToDirector: () => set(directorView),
  stopFollowing: () => set({ flyRequest: null }),

  loadScenario: (scenario) => set({
    ...directorView,
    scenario,
    t: 0,
    playing: false,
    speedMultiplier: 1,
    externalClock: null,
    currentAct: actAt(scenario, 0),
  }),
  updateScenario: (scenario) => set((state) => {
    const selection = state.selection && displayPositionOf(state.selection, scenario, state.t) ? state.selection : null;
    return {
      scenario,
      currentAct: actAt(scenario, state.t),
      ...(state.selection && !selection ? { selection: null, hovered: null, flyRequest: null } : {}),
    };
  }),
  clearScenario: () => set({ ...directorView, scenario: null, t: 0, playing: false, externalClock: null, currentAct: null }),

  advance: (delta) => {
    const { scenario, t, playing, speedMultiplier, currentAct, externalClock } = get();
    if (!scenario || !playing) return;

    const next = Math.min(scenario.duration, externalClock ?? scenario.duration,
      t + delta * (externalClock === null ? (currentAct?.rate ?? 1) : 1) * speedMultiplier);
    let pauseAt: number | undefined;
    for (const act of externalClock === null ? scenario.acts : []) {
      if (act.pauseAt !== undefined && t < act.pauseAt && next >= act.pauseAt
        && (pauseAt === undefined || act.pauseAt < pauseAt)) {
        pauseAt = act.pauseAt;
      }
    }
    const nextT = pauseAt ?? next;

    set({
      t: nextT,
      currentAct: actAt(scenario, nextT),
      playing: pauseAt !== undefined ? false : nextT < scenario.duration,
    });
  },

  togglePlaying: () => set((state) => ({
    playing: state.scenario !== null && state.t < state.scenario.duration
      ? !state.playing
      : false,
  })),

  restart: () => set((state) => ({
    ...directorView,
    t: 0,
    playing: false,
    currentAct: state.scenario ? actAt(state.scenario, 0) : null,
  })),

  jumpToAct: (id) => set((state) => {
    const scenario = state.scenario;
    const act = scenario?.acts.find((item) => item.id === id);
    if (!scenario || !act) return state;
    return {
      t: act.start,
      currentAct: actAt(scenario, act.start),
      playing: act.pauseAt === act.start ? false : state.playing,
    };
  }),

  seek: (seconds) => get().seekTo(get().t + seconds),

  seekTo: (time) => set((state) => {
    if (!state.scenario) return state;
    const t = Math.max(0, Math.min(state.scenario.duration, time));
    return {
      t,
      currentAct: actAt(state.scenario, t),
      playing: t < state.scenario.duration && state.playing,
    };
  }),

  setSpeedMultiplier: (speedMultiplier) => set({ speedMultiplier }),
  syncExternalClock: (time, playing) => set((state) => {
    if (!state.scenario) return state;
    const target = Math.max(0, Math.min(state.scenario.duration, time));
    const snap = !playing || target < state.t || target - state.t > 1;
    return {
      externalClock: target,
      ...(snap ? { t: target, currentAct: actAt(state.scenario, target) } : {}),
      playing,
    };
  }),
  toggleHud: () => set((state) => ({ hudVisible: !state.hudVisible })),
  toggleFreeCamera: () => set((state) => state.freeCamera
    ? directorView
    : { freeCamera: true, selection: null, hovered: null, flyRequest: null }),
}));
