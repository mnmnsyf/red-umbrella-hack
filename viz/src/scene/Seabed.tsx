import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshStandardMaterial, PlaneGeometry } from 'three';
import { loadTexture } from '../lib/textures';
import { COLORS, HORIZON, TEXTURES, VEXAG, WORLD_SIZE } from '../theme';

const SEGMENTS = 512;

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
    const plane = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
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
    const sand = loadTexture(TEXTURES.sand);
    sand.repeat.set(28, 28);
    const caustics = loadTexture(TEXTURES.caustics, false);

    const surface = new MeshStandardMaterial({ map: sand, color: '#ffffff', roughness: 1, metalness: 0 });
    const uniforms = {
      contourColor: { value: new Color(COLORS.ink) },
      deepTint: { value: new Color('#bcd6e2') },
      causticsMap: { value: caustics },
      time: { value: 0 },
    };
    surface.userData.uniforms = uniforms;
    surface.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying float vContourDepth;
varying vec2 vWorldXZ;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vContourDepth = -position.z / ${VEXAG.toFixed(1)};
          vWorldXZ = vec2(position.x, -position.y);
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vContourDepth;
varying vec2 vWorldXZ;
uniform vec3 contourColor;
uniform vec3 deepTint;
uniform sampler2D causticsMap;
uniform float time;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float minorPhase = abs(fract(vContourDepth / 1.0 + 0.5) - 0.5);
          float majorPhase = abs(fract(vContourDepth / 5.0 + 0.5) - 0.5);
          float minorLine = 1.0 - smoothstep(0.0, max(fwidth(vContourDepth) * 0.9, 0.001), minorPhase);
          float majorLine = 1.0 - smoothstep(0.0, max(fwidth(vContourDepth / 5.0) * 1.4, 0.001), majorPhase);
          float depthMix = smoothstep(18.0, 42.0, vContourDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb * 1.12, diffuseColor.rgb * deepTint, depthMix * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, contourColor, minorLine * 0.28 + majorLine * 0.6);
        `)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec2 cuv = vWorldXZ / 210.0;
          float c1 = texture2D(causticsMap, cuv + vec2(time * 0.018, time * 0.011)).r;
          float c2 = texture2D(causticsMap, cuv * 0.83 + vec2(-time * 0.013, time * 0.016)).r;
          float caustic = min(c1, c2);
          float fade = 1.0 - smoothstep(14.0, 46.0, vContourDepth) * 0.6;
          totalEmissiveRadiance += vec3(0.92, 0.98, 1.0) * caustic * 0.5 * fade + vec3(0.05, 0.07, 0.08);
        `)
        .replace('#include <fog_fragment>', `
          float horizonFog = max(
            smoothstep(fogNear, fogFar, vFogDepth),
            smoothstep(${HORIZON.fadeStart.toFixed(1)}, ${HORIZON.fadeEnd.toFixed(1)}, length(vWorldXZ))
          );
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, horizonFog);
        `);
    };
    surface.customProgramCacheKey = () => 'seabed-open-v1';
    return surface;
  }, []);

  useFrame(({ clock }) => {
    material.userData.uniforms.time.value = clock.elapsedTime;
  });

  return (
    <mesh rotation-x={-Math.PI / 2} geometry={geometry}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}
