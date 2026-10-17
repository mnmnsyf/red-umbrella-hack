import { create } from 'zustand';
import type { Act, Scenario } from './types';

interface PlaybackStore {
  scenario: Scenario | null;
  t: number;
  playing: boolean;
  speedMultiplier: number;
  currentAct: Act | null;
  hudVisible: boolean;
  freeCamera: boolean;
  loadScenario: (scenario: Scenario) => void;
  advance: (delta: number) => void;
  togglePlaying: () => void;
  restart: () => void;
  jumpToAct: (id: number) => void;
  seek: (seconds: number) => void;
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
  freeCamera: false,

  loadScenario: (scenario) => set({
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
    const pause = scenario.acts.find((act) =>
      act.pauseAt !== undefined && t < act.pauseAt && next >= act.pauseAt,
    );
    const nextT = pause?.pauseAt ?? next;

    set({
      t: nextT,
      currentAct: actAt(scenario, nextT),
      playing: pause ? false : nextT < scenario.duration,
    });
  },

  togglePlaying: () => set((state) => ({
    playing: state.scenario !== null && state.t < state.scenario.duration
      ? !state.playing
      : false,
  })),

  restart: () => set((state) => ({
    t: 0,
    playing: false,
    currentAct: state.scenario ? actAt(state.scenario, 0) : null,
  })),

  jumpToAct: (id) => set((state) => {
    const act = state.scenario?.acts.find((item) => item.id === id);
    if (!act) return state;
    return {
      t: act.start,
      currentAct: act,
      playing: act.pauseAt === act.start ? false : state.playing,
    };
  }),

  seek: (seconds) => set((state) => {
    if (!state.scenario) return state;
    const t = Math.max(0, Math.min(state.scenario.duration, state.t + seconds));
    return {
      t,
      currentAct: actAt(state.scenario, t),
      playing: t < state.scenario.duration && state.playing,
    };
  }),

  setSpeedMultiplier: (speedMultiplier) => set({ speedMultiplier }),
  toggleHud: () => set((state) => ({ hudVisible: !state.hudVisible })),
  toggleFreeCamera: () => set((state) => ({ freeCamera: !state.freeCamera })),
}));
