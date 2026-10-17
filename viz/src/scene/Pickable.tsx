import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, MeshBasicMaterial } from 'three';
import { usePlaybackStore, type Selection } from '../store';
import { COLORS } from '../theme';

export default function Pickable({ selection, radius, ringY = -radius * 0.55, children }: {
  selection: Selection;
  radius: number;
  ringY?: number;
  children: ReactNode;
}) {
  const select = usePlaybackStore((state) => state.select);
  const setHovered = usePlaybackStore((state) => state.setHovered);
  const hovered = usePlaybackStore((state) => state.hovered);
  const selected = usePlaybackStore((state) => state.selection);
  const isHovered = hovered?.kind === selection.kind && hovered.id === selection.id;
  const isSelected = selected?.kind === selection.kind && selected.id === selection.id;
  const ring = useRef<MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    if (ring.current && isSelected) ring.current.opacity = 0.75 + 0.15 * Math.sin(clock.elapsedTime * 3);
  });

  useEffect(() => () => {
    const current = usePlaybackStore.getState().hovered;
    if (current?.kind === selection.kind && current.id === selection.id) {
      usePlaybackStore.getState().setHovered(null);
      document.body.style.cursor = '';
    }
  }, [selection.kind, selection.id]);

  return (
    <group
      onClick={(event) => {
        if (event.delta > 4) return;
        event.stopPropagation();
        select(selection);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(selection);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        const current = usePlaybackStore.getState().hovered;
        if (current?.kind === selection.kind && current.id === selection.id) {
          setHovered(null);
          document.body.style.cursor = '';
        }
      }}
    >
      <mesh>
        <sphereGeometry args={[radius, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {children}
      {(isHovered || isSelected) && (
        <mesh position={[0, ringY, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[radius * 0.82, radius, 48]} />
          <meshBasicMaterial ref={ring} color={COLORS.acoustic} transparent opacity={isSelected ? 0.9 : 0.5} depthWrite={false} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
