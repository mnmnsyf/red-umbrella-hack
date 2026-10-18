import { create } from 'zustand';
import type { Act, Scenario } from './types';
import type { Vec3 } from './types';
import { displayPositionOf, INSPECT_DISTANCE } from './scene/selectable';

export type SelectableKind = 'hydrophone' | 'contact' | 'drone' | 'ferry' | 'zone';
export interface Selection { kind: SelectableKind; id: string }

const directorView = { selection: null, hovered: null, flyRequest: null, freeCamera: false };

interface PlaybackStore {
  scenario: Scenario | null;
  t: number;
  playing: boolean;
  speedMultiplier: number;
  currentAct: Act | null;
  hudVisible: boolean;
  freeCamera: boolean;
  selection: Selection | null;
  hovered: Selection | null;
  flyRequest: { target: Vec3; distance: number; follow: Selection | null; requestedAt: number } | null;
  select: (selection: Selection) => void;
  flyToPoint: (point: Vec3) => void;
  setHovered: (selection: Selection | null) => void;
  backToDirector: () => void;
  loadScenario: (scenario: Scenario) => void;
  advance: (delta: number) => void;
  togglePlaying: () => void;
  restart: () => void;
  jumpToAct: (id: number) => void;
  seek: (seconds: number) => void;
  seekTo: (time: number) => void;
  setSpeedMultiplier: (speed: number) => void;
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
  setHovered: (hovered) => set({ hovered }),
  backToDirector: () => set(directorView),

  loadScenario: (scenario) => set({
    ...directorView,
    scenario,
    t: 0,
    playing: false,
    speedMultiplier: 1,
    currentAct: actAt(scenario, 0),
  }),

  advance: (delta) => {
    const { scenario, t, playing, speedMultiplier, currentAct } = get();
    if (!scenario || !playing) return;

    const next = Math.min(scenario.duration, t + delta * (currentAct?.rate ?? 1) * speedMultiplier);
    let pauseAt: number | undefined;
    for (const act of scenario.acts) {
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
  toggleHud: () => set((state) => ({ hudVisible: !state.hudVisible })),
  toggleFreeCamera: () => set((state) => state.freeCamera
    ? directorView
    : { freeCamera: true, selection: null, hovered: null, flyRequest: null }),
}));
