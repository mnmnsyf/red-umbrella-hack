import { useMemo } from 'react';
import { Color, MeshStandardMaterial, PlaneGeometry } from 'three';
import { COLORS, SCENE_SIZE, VEXAG } from '../theme';

const SEGMENTS = 256;

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const hash = (a: number, b: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  };
  const near = hash(ix, iz) * (1 - sx) + hash(ix + 1, iz) * sx;
  const far = hash(ix, iz + 1) * (1 - sx) + hash(ix + 1, iz + 1) * sx;
  return near * (1 - sz) + far * sz;
}

export function seabedDepthAt(x: number, z: number): number {
  const hills = 4.5 * valueNoise(x / 180, z / 180)
    + 1.5 * valueNoise(x / 65, z / 65);
  const channelDistance = (x - 200) / 120;
  const channel = 12 * Math.exp(-channelDistance * channelDistance);
  return -25 + hills - channel;
}

export default function Seabed() {
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(SCENE_SIZE, SCENE_SIZE, SEGMENTS, SEGMENTS);
    const positions = plane.attributes.position;

    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = -positions.getY(i);
      positions.setZ(i, seabedDepthAt(x, z) * VEXAG);
    }

    plane.computeVertexNormals();
    return plane;
  }, []);

  const material = useMemo(() => {
    const surface = new MeshStandardMaterial({
      color: COLORS.seabed,
      emissive: COLORS.seabed,
      emissiveIntensity: 0.08,
      roughness: 0.95,
    });
    surface.onBeforeCompile = (shader) => {
      shader.uniforms.contourColor = { value: new Color(COLORS.acoustic) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vContourDepth;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vContourDepth = -position.z / ${VEXAG.toFixed(1)};
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vContourDepth;\nuniform vec3 contourColor;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float minorPhase = abs(fract(vContourDepth / 2.0 + 0.5) - 0.5);
          float majorPhase = abs(fract(vContourDepth / 10.0 + 0.5) - 0.5);
          float minorLine = 1.0 - smoothstep(0.0, max(fwidth(vContourDepth / 2.0) * 1.1, 0.001), minorPhase);
          float majorLine = 1.0 - smoothstep(0.0, max(fwidth(vContourDepth / 10.0) * 2.0, 0.001), majorPhase);
          totalEmissiveRadiance += contourColor * (minorLine * 1.5 + majorLine * 2.2);
        `);
    };
    surface.customProgramCacheKey = () => 'seabed-contours-v1';
    return surface;
  }, []);

  return (
    <mesh rotation-x={-Math.PI / 2} geometry={geometry}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}
