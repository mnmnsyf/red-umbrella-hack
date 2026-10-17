import { Sparkles } from '@react-three/drei';
import Seabed from './Seabed';
import WaterSurface from './WaterSurface';
import { COLORS } from '../theme';

export default function Environment() {
  return (
    <>
      <fog attach="fog" args={[COLORS.background, 450, 2350]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[800, 350, 300]} color={COLORS.acoustic} intensity={0.8} />
      <Seabed />
      <WaterSurface />
      <Sparkles count={140} scale={[1800, 170, 1800]} position={[0, -80, 0]} size={2.5} speed={0.25} opacity={0.3} color={COLORS.acoustic} />
    </>
  );
}
