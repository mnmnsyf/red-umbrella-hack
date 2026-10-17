import type { CSSProperties } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { COLORS } from './theme';

const appColors = {
  '--color-background': COLORS.background,
  '--color-shallow-water': COLORS.shallowWater,
  '--color-neutral': COLORS.neutral,
} as CSSProperties;

export default function App() {
  return (
    <div className="app" style={appColors}>
      <Canvas className="scene" camera={{ position: [4, 3, 7], fov: 55 }}>
        <color attach="background" args={[COLORS.background]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 8, 4]} intensity={1.5} />
        <mesh>
          <boxGeometry args={[2, 2, 2]} />
          <meshStandardMaterial color={COLORS.acoustic} />
        </mesh>
        <OrbitControls />
      </Canvas>

      <div className="hud" aria-label="Demo interface placeholders">
        <div className="hud-panel phase-placeholder">PHASE BAR</div>
        <div className="hud-panel action-placeholder">ACTION LOG</div>
        <div className="hud-panel controls-placeholder">CONTROLS</div>
      </div>
    </div>
  );
}
