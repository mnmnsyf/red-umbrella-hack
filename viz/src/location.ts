import { SCENE_SIZE } from './theme';

// The downloaded World Imagery square is north-up in Web Mercator.
export const ANGELS_GATE_MAP = {
  image: '/maps/angels-gate.jpg',
  contextImage: '/maps/angels-gate-context.jpg',
  // Land masks traced from the imagery: white is quay, breakwater or shore, black is water.
  land: '/maps/angels-gate-land.png',
  contextLand: '/maps/angels-gate-context-land.png',
  contextSize: SCENE_SIZE * 3,
  bbox: [-13164773, 3988442, -13161887, 3991327] as const,
  lighthouse: { latitude: 33.7086, longitude: -118.2517 },
};

export function mapPosition(latitude: number, longitude: number): [number, number] {
  const radius = 6378137;
  const longitudeMeters = radius * longitude * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const latitudeMeters = radius * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2));
  const [west, south, east, north] = ANGELS_GATE_MAP.bbox;

  // Scene +x points west and +z points north; the square fills SCENE_SIZE.
  return [
    ((west + east) / 2 - longitudeMeters) / (east - west) * SCENE_SIZE,
    (latitudeMeters - (south + north) / 2) / (north - south) * SCENE_SIZE,
  ];
}
