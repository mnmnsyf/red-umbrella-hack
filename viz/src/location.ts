import { SCENE_SIZE } from './theme';

// Terminal Island container basin, Port of Los Angeles: the same place the dashboard
// (software/portwatch/harbour.py) uses. Built by tools/fetch_harbour_map.py from USGS imagery.
// The square is north-up in Web Mercator and centred on the dashboard's patrol basin, the
// centre software/portwatch/viz_scenario.py puts at the scene origin.
const BASE = import.meta.env.BASE_URL;  // works when the viz is served under a sub-path (e.g. /viz/)

export const HARBOUR_MAP = {
  image: `${BASE}maps/harbour.jpg`,
  contextImage: `${BASE}maps/harbour-context.jpg`,
  // Land masks from the imagery and the dashboard's traced basin: white is quay, pier or shore, black is water.
  land: `${BASE}maps/harbour-land.png`,
  contextLand: `${BASE}maps/harbour-context-land.png`,
  contextSize: SCENE_SIZE * 3,
  bbox: [-13163108, 3993480, -13159741, 3996848] as const,
};

// Scene axes match the dashboard's scenarios: +x east, +z south, 1 unit = 1 local metre.
export function mapPosition(latitude: number, longitude: number): [number, number] {
  const radius = 6378137;
  const longitudeMeters = radius * longitude * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const latitudeMeters = radius * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2));
  const [west, south, east, north] = HARBOUR_MAP.bbox;

  return [
    (longitudeMeters - (west + east) / 2) / (east - west) * SCENE_SIZE,
    ((south + north) / 2 - latitudeMeters) / (north - south) * SCENE_SIZE,
  ];
}
