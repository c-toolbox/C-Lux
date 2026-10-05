import { useEffect, useRef } from 'react';

import config from '../../config.json';
import { patternByType, type PatternProps, type PatternType } from '../lib/api';

import { drawLights } from './drawLights';

const NUM_LIGHTS = config.nLights;

// Longest step fed to the pattern, so a backgrounded tab doesn't resume with a huge jump.
const MAX_DT = 0.1;

type PatternInstance = InstanceType<NonNullable<ReturnType<typeof patternByType>>>;

interface PatternPreviewProps {
  type: PatternType;
  props: PatternProps;
}

// Runs a pattern locally in the browser from unsaved form values, so it can be seen
// before it is added to the lights.
export function PatternPreview({ type, props }: PatternPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const patternRef = useRef<PatternInstance | null>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
    try {
      patternRef.current?.update(props);
    } catch {
      // Half-edited values can be invalid; keep showing the last good state.
    }
  }, [props]);

  useEffect(() => {
    const cls = patternByType(type);
    try {
      patternRef.current = cls ? new cls(propsRef.current) : null;
    } catch {
      patternRef.current = null;
    }

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;
      const pattern = patternRef.current;
      const canvas = canvasRef.current;
      if (pattern && canvas) {
        try {
          pattern.tick(dt);
          const data = pattern.data();
          const rgb: number[] = [];
          // Blend over black, as the lights do with nothing underneath.
          for (let i = 0; i < NUM_LIGHTS; i++) {
            const a = data[i * 4 + 3];
            rgb.push(data[i * 4] * a, data[i * 4 + 1] * a, data[i * 4 + 2] * a);
          }
          drawLights(canvas, rgb);
        } catch {
          patternRef.current = null;
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      patternRef.current = null;
    };
  }, [type]);

  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
