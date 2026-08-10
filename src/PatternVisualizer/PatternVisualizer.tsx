import { useEffect, useRef } from 'react';

import config from '../../config.json';
import { api } from '../lib/api';

const NUM_LIGHTS = config.nLights;

function drawLights(canvas: HTMLCanvasElement, data: number[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 10;
  const innerR = outerR * 0.9;
  const half = Math.PI / NUM_LIGHTS;

  for (let i = 0; i < NUM_LIGHTS; i++) {
    const a = (2 * Math.PI * i) / NUM_LIGHTS;
    const start = -a - half;
    const end = -a + half;
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, start, end);
    ctx.arc(cx, cy, innerR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fill();
  }
}

export function PatternVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number;

    const BASE_MS = 100;
    const MAX_MS = 5000;
    let delay = BASE_MS;

    async function poll() {
      try {
        const data = await api.getPattern();
        if (!active) return;
        if (canvasRef.current) drawLights(canvasRef.current, data);
        delay = BASE_MS;
      } catch {
        // Back off while the backend is unreachable to avoid spamming requests
        delay = Math.min(delay * 2, MAX_MS);
      }
      if (active) timer = window.setTimeout(poll, delay);
    }

    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        maxWidth: 420,
        aspectRatio: '1 / 1',
        margin: '0 auto',
        display: 'block'
      }}
    />
  );
}
