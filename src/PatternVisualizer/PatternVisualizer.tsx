import { useEffect, useRef } from 'react';

import config from '../../config.json';
import logo from '../assets/C_transparent.png';
import { subscribeFrames } from '../lib/api';

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
    const a = (2 * Math.PI * i) / NUM_LIGHTS + Math.PI / 2;
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
    // Draw each blended frame pushed by the server; EventSource reconnects on its own if
    // the backend drops, so no manual polling or back-off is needed.
    return subscribeFrames((data) => {
      if (canvasRef.current) drawLights(canvasRef.current, data);
    });
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 420,
        aspectRatio: '1 / 1',
        margin: '0 auto'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />
      <img
        src={logo}
        alt={'C-Lux'}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-52.5%, -50%)',
          width: '40%',
          height: 'auto',
          pointerEvents: 'none',
          filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25))'
        }}
      />
    </div>
  );
}
