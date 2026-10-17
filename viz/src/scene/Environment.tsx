import LightRays from './LightRays';
import Seabed from './Seabed';
import WaterSurface from './WaterSurface';
import { HORIZON } from '../theme';

export default function Environment() {
  return (
    <>
      <fog attach="fog" args={[HORIZON.color, HORIZON.near, HORIZON.far]} />
      <hemisphereLight args={['#ffffff', '#d8e2e8', 1.35]} />
      <directionalLight position={[1300, 1700, 1100]} color="#fff8ee" intensity={0.85} />
      <Seabed />
      <LightRays />
      <WaterSurface />
    </>
  );
}
