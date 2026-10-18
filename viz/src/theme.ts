export const VEXAG = 4;
export const SCENE_SIZE = 2800;  // must match tools/fetch_harbour_map.py; covers the 2.5 km patrol basin
// Seabed and water run on past the harbour and dissolve into the backdrop, so the scene has no visible edge.
export const WORLD_SIZE = SCENE_SIZE * 4;
export const HORIZON = { color: '#e1e7eb', near: 3600, far: 9500, fadeStart: 2600, fadeEnd: 5600 };

// Palette matches the Harbour Acoustic Watch dashboard; the scene is an open, sunlit harbour.
export const COLORS = {
  background: '#eef1f4',
  paper: '#fbfcfd',
  ink: '#13283a',
  line: '#d5dce3',
  shallowWater: '#bfe3f0',
  deepWater: '#2f7fa6',
  underwaterFog: '#9fc3d6',
  seabed: '#e6dfd0',
  neutral: '#5b6b7a',
  acoustic: '#0f7c8c',
  automatic: '#2e7d4f',
  approval: '#b7791f',
  protectedZone: '#c62828',
  intruder: '#13283a',
} as const;

const BASE = import.meta.env.BASE_URL;  // lets the viz be served under a sub-path (e.g. /viz/)

export const TEXTURES = {
  sand: `${BASE}textures/web/seabed-sand.jpg`,
  caustics: `${BASE}textures/web/caustics.jpg`,
  grain: `${BASE}textures/web/paper-grain.jpg`,
  backdrop: `${BASE}textures/web/backdrop.jpg`,
  insignia: `${BASE}textures/web/insignia.png`,
} as const;

export const FONT = "'Barlow', system-ui, sans-serif";
export const FONT_DISPLAY = "'Barlow Semi Condensed', 'Barlow', system-ui, sans-serif";
