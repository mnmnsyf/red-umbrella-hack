import { headingAt, positionAt } from '../lib/interp';
import { usePlaybackStore } from '../store';
import { VEXAG } from '../theme';
import Model, { MODEL_URLS } from './Model';

export default function SurfaceBoats() {
  const boats = usePlaybackStore((state) => state.scenario?.surfaceBoats);
  const t = usePlaybackStore((state) => state.t);

  return (
    <>
      {boats?.map((boat) => {
        const [x, y, z] = positionAt(boat.path, t);
        const yaw = headingAt(boat.path, t) - Math.PI / 2;
        return (
          <group key={boat.id} position={[x, y * VEXAG, z]} rotation-y={yaw}>
            <Model url={MODEL_URLS.ferry} length={110} sink={0.25} />
          </group>
        );
      })}
    </>
  );
}
