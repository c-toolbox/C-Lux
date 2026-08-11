import config from '../../config.json' with { type: 'json' };

export interface Color {
  r: number;
  g: number;
  b: number;
}

// Internal per-light color carrying an alpha channel in [0, 1] used for blending.
export interface ColorAlpha extends Color {
  a: number;
}

export interface PatternBaseProps {
  name: string;
}

// This type is a lighting pattern that is shown on the light display. The `tick` function
// has to be called at regular intervals to update the lighting pattern. The data for the
// pattern itself is returned through the `data` function
export abstract class Pattern {
  name: string;
  state: Array<ColorAlpha>;

  previous_time: number = 0;
  current_time: number = 0;

  constructor({ name }: PatternBaseProps) {
    this.name = name;
    this.state = Array.from({ length: config.nLights }, () => ({
      r: 0,
      g: 0,
      b: 0,
      a: 0
    }));
  }

  /**
   * Returns the parameters of the concrete subclass as an object.
   */
  abstract parameters(): object;

  /**
   * Sets all of the parameters of the concrete subclass. If a parameter is not present
   * in the provided object, the subclass keeps the current value.
   */
  abstract set(values: object): void;

  /**
   * Perform a single tick to support animations.
   *
   * @param dt The frame time, so how much time has passed (in seconds) since the previous
   *           update
   */
  tick(dt: number): void {
    this.advance(dt);
  }

  /**
   * Advance the animation by one frame. Subclasses implement their motion here.
   *
   * @param dt The frame time, so how much time has passed (in seconds) since the previous
   *           update
   */
  protected abstract advance(dt: number): void;

  // Flat per-light values as [r, g, b, a, ...]; alpha lets the server blend layers.
  data(): Array<number> {
    const res: Array<number> = [];
    for (const c of this.state) {
      res.push(c.r);
      res.push(c.g);
      res.push(c.b);
      res.push(c.a);
    }
    return res;
  }

  protected updateTime(dt: number) {
    this.previous_time = this.current_time;
    this.current_time += dt;
  }

  protected rotate(steps: number) {
    if (steps == 0) return;
    if (this.state.length == 0) return;

    const reverse = steps < 0;
    if (steps < 0) {
      steps = Math.abs(steps);
    }
    for (let i = 0; i < steps; i++) {
      if (reverse) {
        this.state.unshift(this.state.pop()!);
      } else {
        this.state.push(this.state.shift()!);
      }
    }
  }
}
