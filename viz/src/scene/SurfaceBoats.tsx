import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { COLORS, VEXAG } from '../theme';
import Model, { MODEL_URLS } from './Model';
import Callout from './fx/Callout';
import Pickable from './Pickable';

export default function SurfaceBoats() {
  const boats = usePlaybackStore((state) => state.scenario?.surfaceBoats);
  const t = usePlaybackStore((state) => state.t);

  return (
    <>
      {boats?.map((boat) => {
        const [x, y, z] = positionAt(boat.path, t);
        const yaw = headingAt(boat.path, t) - Math.PI / 2;
        return (
          <group key={boat.id}>
            <group position={[x, y * VEXAG, z]}>
              <Pickable selection={{ kind: 'ferry', id: boat.id }} radius={60}>
                <group rotation-y={yaw}>
                  <Model url={MODEL_URLS.ferry} length={150} sink={0.25} />
                </group>
              </Pickable>
            </group>
            <Callout position={[x, y, z]} label="Ferry" color={COLORS.neutral} height={80} />
          </group>
        );
      })}
    </>
  );
}
