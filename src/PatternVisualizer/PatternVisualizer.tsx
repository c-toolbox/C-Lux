import { useEffect, useRef, useState } from 'react';

import logo from '../assets/c-logo.png';
import { subscribeFrames } from '../lib/api';

import { drawLights } from './drawLights';

export function PatternVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [spinning, setSpinning] = useState(false);

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
        maxWidth: 600,
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
        className={spinning ? 'logo-spinning' : undefined}
        onClick={() => setSpinning(true)}
        onAnimationEnd={() => setSpinning(false)}
        style={{
          position: 'absolute',
          top: '30%',
          left: '30%',
          width: '40%',
          height: 'auto',
          cursor: 'pointer',
          filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25))'
        }}
      />
    </div>
  );
}
