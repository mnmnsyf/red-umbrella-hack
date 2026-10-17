import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Object3D } from 'three';
import { usePlaybackStore } from '../store';
import { VEXAG } from '../theme';
import type { Scenario } from '../types';

type Fish = NonNullable<Scenario['fish']>;

const FISH_COLOR = '#81e6d9';
const TAU = Math.PI * 2;
const FADE_SECONDS = 1;

function FishInstances({ fish }: { fish: Fish }) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const positions = useMemo(() => {
    let seed = 0x54a31c27;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    const values = new Float32Array(fish.count * 5);
    for (let i = 0; i < fish.count; i += 1) {
      const heightDirection = random() * 2 - 1;
      const distance = Math.cbrt(random());
      const offset = i * 5;
      values[offset] = Math.sqrt(1 - heightDirection * heightDirection) * distance * fish.radiusXZ;
      values[offset + 1] = random() * TAU;
      values[offset + 2] = heightDirection * distance * fish.radiusY;
      values[offset + 3] = (0.018 + random() * 0.018) * (random() < 0.5 ? -1 : 1);
      values[offset + 4] = random() * TAU;
    }
    return values;
  }, [fish.count, fish.radiusXZ, fish.radiusY]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const elapsed = clock.elapsedTime;
    for (let i = 0; i < fish.count; i += 1) {
      const offset = i * 5;
      const angle = positions[offset + 1] + elapsed * positions[offset + 3];
      dummy.position.set(
        Math.cos(angle) * positions[offset],
        (positions[offset + 2] + Math.sin(elapsed * 0.7 + positions[offset + 4]) * 0.35) * VEXAG,
        Math.sin(angle) * positions[offset],
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[fish.center[0], fish.center[1] * VEXAG, fish.center[2]]}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, fish.count]} frustumCulled={false}>
        <sphereGeometry args={[1.2, 5, 4]} />
        <meshStandardMaterial
          color={FISH_COLOR}
          emissive={FISH_COLOR}
          emissiveIntensity={0.15}
          transparent
          opacity={0.8}
          depthWrite={false}
          roughness={0.8}
        />
      </instancedMesh>
    </group>
  );
}

function FishLabel({ fish, detectAt }: { fish: Fish; detectAt: number | undefined }) {
  const t = usePlaybackStore((state) => state.t);
  const fade = detectAt === undefined ? 0 : Math.max(0, Math.min(1, (t - detectAt) / FADE_SECONDS));
  const opacity = 1 - fade * 0.65;

  return (
    <Html
      position={[fish.center[0], (fish.center[1] + fish.radiusY + 5) * VEXAG, fish.center[2]]}
      center
      zIndexRange={[10, 0]}
    >
      <div className="scene-label" style={{ borderColor: FISH_COLOR, opacity }}>
        {fish.label}
      </div>
    </Html>
  );
}

export default function FishCloud() {
  const scenario = usePlaybackStore((state) => state.scenario);
  if (!scenario?.fish || scenario.fish.count <= 0) return null;

  const detectAt = scenario.events.find((event) => event.type === 'phase' && event.phase === 'DETECT')?.t;
  return (
    <>
      <FishInstances fish={scenario.fish} />
      <FishLabel fish={scenario.fish} detectAt={detectAt} />
    </>
  );
}
