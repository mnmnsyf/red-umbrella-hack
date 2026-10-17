import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';

const MIN_SCALE = 0.85;
const MARGIN = 16;

// Scene labels that would sit under a HUD card fade out instead of showing half-covered.
function tuckLabelsUnderHud() {
  const cards = [...document.querySelectorAll<HTMLElement>('.hud .hud-panel')].map((panel) => panel.getBoundingClientRect());
  document.querySelectorAll<HTMLElement>('.scene-tag, .scene-label').forEach((label) => {
    const box = label.getBoundingClientRect();
    const covered = cards.some((card) => box.right > card.left && box.left < card.right && box.bottom > card.top && box.top < card.bottom);
    label.classList.toggle('under-hud', covered);
  });
}

// Fits the rendered view into the screen area the HUD cards leave free, so shots stay centred and nothing sits under a card.
export default function SafeFrame() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const frame = useRef(0);
  const last = useRef('');

  useFrame(() => {
    frame.current += 1;
    if (frame.current % 6 === 0) tuckLabelsUnderHud();
    if (frame.current % 15 !== 1 || !(camera instanceof PerspectiveCamera)) return;

    const width = size.width;
    const height = size.height;
    let left = MARGIN;
    let right = width - MARGIN;
    let top = MARGIN;
    let bottom = height - MARGIN;
    document.querySelectorAll<HTMLElement>('.hud .hud-panel').forEach((panel) => {
      const box = panel.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const wide = box.width > width * 0.6;
      if (wide && box.top < height / 2) top = Math.max(top, box.bottom + MARGIN);
      else if (wide) bottom = Math.min(bottom, box.top - MARGIN);
      else if (box.height > height * 0.25 && box.right < width / 2) left = Math.max(left, box.right + MARGIN);
      else if (box.height > height * 0.25 && box.left > width / 2) right = Math.min(right, box.left - MARGIN);
    });

    const safeWidth = Math.max(1, right - left);
    const safeHeight = Math.max(1, bottom - top);
    const scale = Math.max(MIN_SCALE, Math.min(1, safeWidth / width, safeHeight / height));
    const fullWidth = width / scale;
    const fullHeight = height / scale;
    const x = fullWidth / 2 - (left + right) / 2;
    const y = fullHeight / 2 - (top + bottom) / 2;
    const key = `${fullWidth.toFixed(1)}:${fullHeight.toFixed(1)}:${x.toFixed(1)}:${y.toFixed(1)}`;
    if (key === last.current) return;
    last.current = key;
    camera.setViewOffset(fullWidth, fullHeight, x, y, width, height);
    camera.updateProjectionMatrix();
  });

  return null;
}
