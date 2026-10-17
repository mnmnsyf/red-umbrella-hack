import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Mesh, MeshStandardMaterial, Vector3, type Material } from 'three';

export const MODEL_URLS = {
  ferry: `${import.meta.env.BASE_URL}models/ferry.glb`,
  droneBoat: `${import.meta.env.BASE_URL}models/drone-boat.glb`,
  auv: `${import.meta.env.BASE_URL}models/auv.glb`,
} as const;

Object.values(MODEL_URLS).forEach((url) => useGLTF.preload(url));

interface ModelProps {
  url: string;
  length: number;
  opacity?: number;
  sink?: number;
  flip?: boolean;
  glow?: number;
}

function FittedModel({ url, length, opacity = 1, sink = 0, flip = false, glow = 0 }: ModelProps) {
  const { scene } = useGLTF(url);
  const { object, materials, scale, offset } = useMemo(() => {
    const clone = scene.clone(true);
    const cloned: Material[] = [];
    clone.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.material = Array.isArray(child.material)
        ? child.material.map((material: Material) => material.clone())
        : child.material.clone();
      cloned.push(...[child.material as Material | Material[]].flat());
    });
    for (const material of cloned) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.emissive.copy(material.color);
      material.emissiveMap = material.map;
      material.emissiveIntensity = glow;
    }

    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    return {
      object: clone,
      materials: cloned,
      scale: length / size.z,
      offset: [-center.x, -box.min.y - size.y * sink, -center.z] as [number, number, number],
    };
  }, [scene, length, sink, glow]);

  const transparent = opacity < 1;
  for (const material of materials) {
    if (material.transparent !== transparent) material.needsUpdate = true;
    material.transparent = transparent;
    material.opacity = opacity;
    material.depthWrite = !transparent;
  }

  return (
    <group rotation-y={Math.PI / 2 + (flip ? Math.PI : 0)} scale={scale}>
      <primitive object={object} position={offset} />
    </group>
  );
}

export default function Model(props: ModelProps) {
  return (
    <Suspense fallback={null}>
      <FittedModel {...props} />
    </Suspense>
  );
}
