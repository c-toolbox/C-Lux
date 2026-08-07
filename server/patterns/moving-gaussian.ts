import { type Color, Pattern, type PatternBaseProps } from './pattern.ts';

export type MovingGaussianProps = PatternBaseProps &
  Color & {
    sigma: number;
    speed: number;
  };

export class MovingGaussianPattern extends Pattern {
  static readonly Type = 'MovingGaussian';

  r!: number;
  g!: number;
  b!: number;
  sigma!: number;
  speed!: number;

  constructor(props: MovingGaussianProps) {
    super(props);
    this.set(props);
  }

  parameters(): {
    name: string;
    type: typeof MovingGaussianPattern.Type;
    color: Color;
    sigma: number;
    speed: number;
  } {
    return {
      name: this.name,
      type: MovingGaussianPattern.Type,
      color: {
        r: this.r,
        g: this.g,
        b: this.b
      },
      sigma: this.sigma,
      speed: this.speed
    };
  }

  set({ r, g, b, sigma, speed }: Partial<MovingGaussianProps>) {
    this.r = r ?? this.r;
    this.g = g ?? this.g;
    this.b = b ?? this.b;
    this.sigma = sigma ?? this.sigma;
    this.speed = speed ?? this.speed;

    // @TODO Proper gaussian
    this.state[-5] = { r: this.r, g: this.g, b: this.b };
    this.state[-4] = { r: this.r, g: this.g, b: this.b };
    this.state[-3] = { r: this.r, g: this.g, b: this.b };
    this.state[-2] = { r: this.r, g: this.g, b: this.b };
    this.state[-1] = { r: this.r, g: this.g, b: this.b };
    this.state[0] = { r: this.r, g: this.g, b: this.b };
    this.state[1] = { r: this.r, g: this.g, b: this.b };
    this.state[2] = { r: this.r, g: this.g, b: this.b };
    this.state[3] = { r: this.r, g: this.g, b: this.b };
    this.state[3] = { r: this.r, g: this.g, b: this.b };
    this.state[5] = { r: this.r, g: this.g, b: this.b };

    // @TODO Don't start the traversal at zero but use the current location
  }

  tick(dt: number) {
    this.rotate(this.speed * dt);
  }
}
