import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, PointLight } from 'three';
import { ANGELS_GATE_MAP, mapPosition } from '../location';
import Pickable from './Pickable';

const [x, z] = mapPosition(
  ANGELS_GATE_MAP.lighthouse.latitude,
  ANGELS_GATE_MAP.lighthouse.longitude,
);

export default function Lighthouse() {
  const beacon = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);

  useFrame(({ clock }) => {
    const flash = clock.elapsedTime % 15 < 0.5;
    if (beacon.current) {
      const material = beacon.current.material;
      if (material instanceof MeshStandardMaterial) material.emissiveIntensity = flash ? 3 : 0.2;
    }
    if (light.current) light.current.intensity = flash ? 35 : 0;
  });

  return (
    <group position={[x, 0, z]}>
      <group position={[0, 15, 0]}>
      <Pickable selection={{ kind: 'lighthouse', id: 'lighthouse' }} radius={25}>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[4, 6, 30, 16]} />
        <meshStandardMaterial color="#f4f5ec" roughness={0.75} />
      </mesh>
      <mesh ref={beacon} position={[0, 16, 0]}>
        <sphereGeometry args={[4.5, 16, 12]} />
        <meshStandardMaterial color="#53f593" emissive="#18e968" emissiveIntensity={0.2} />
      </mesh>
      <pointLight ref={light} position={[0, 16, 0]} color="#35ff8b" distance={160} decay={2} intensity={0} />
      </Pickable>
      </group>
    </group>
  );
}
