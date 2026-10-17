import { positionAt } from '../lib/interp';
import { ANGELS_GATE_MAP, mapPosition } from '../location';
import type { Selection } from '../store';
import { VEXAG } from '../theme';
import type { Scenario, Vec3 } from '../types';
import { seabedDepthAt } from './Seabed';

export const INSPECT_DISTANCE: Record<Selection['kind'], number> = {
  hydrophone: 140,
  contact: 120,
  drone: 120,
  ferry: 380,
  zone: 650,
  lighthouse: 160,
};

export function displayPositionOf(selection: Selection, scenario: Scenario, t: number): Vec3 | null {
  switch (selection.kind) {
    case 'hydrophone': {
      const hydrophone = scenario.hydrophones.find((item) => item.id === selection.id);
      if (!hydrophone) return null;
      const [x, , z] = hydrophone.pos;
      return [x, seabedDepthAt(x, z) * VEXAG, z];
    }
    case 'contact': {
      if (selection.id !== 'contact' || t < scenario.intruder.visibleFrom) return null;
      const [x, y, z] = positionAt(scenario.intruder.path, t);
      return [x, y * VEXAG, z];
    }
    case 'drone': {
      if (selection.id !== 'drone') return null;
      const [x, y, z] = positionAt(scenario.droneBoat.path, t);
      return [x, y * VEXAG, z];
    }
    case 'ferry': {
      const boat = scenario.surfaceBoats.find((item) => item.id === selection.id);
      if (!boat) return null;
      const [x, y, z] = positionAt(boat.path, t);
      return [x, y * VEXAG, z];
    }
    case 'zone': {
      const zone = scenario.zones.find((item) => item.name === selection.id);
      return zone ? [(zone.min[0] + zone.max[0]) / 2, 2, (zone.min[1] + zone.max[1]) / 2] : null;
    }
    case 'lighthouse': {
      if (selection.id !== 'lighthouse') return null;
      const [x, z] = mapPosition(ANGELS_GATE_MAP.lighthouse.latitude, ANGELS_GATE_MAP.lighthouse.longitude);
      return [x, 15, z];
    }
  }
}
