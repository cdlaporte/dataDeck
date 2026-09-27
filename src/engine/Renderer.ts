import { color as parseColor } from 'd3-color';
import {
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Color,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

function srgb(c: string): [number, number, number] {
  const p = parseColor(c)?.rgb();
  return p ? [p.r / 255, p.g / 255, p.b / 255] : [0, 0, 0];
}

const vertexShader = /* glsl */ `
  attribute vec2 aOffset;
  attribute float aRadius;
  attribute vec4 aColor;
  attribute float aHighlight;

  uniform vec3 uTransform; // k, tx, ty
  uniform vec2 uViewport;  // CSS px

  varying vec2 vPos;
  varying float vRadius;
  varying vec4 vColor;
  varying float vHighlight;

  void main() {
    float r = aRadius * uTransform.x;
    float pad = r + 2.0 + aHighlight * 2.0;
    vec2 corner = position.xy * pad;
    vec2 screen = aOffset * uTransform.x + uTransform.yz + corner;
    vPos = corner;
    vRadius = r;
    vColor = aColor;
    vHighlight = aHighlight;
    vec2 clip = screen / uViewport * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uRing;      // surface colour: separates overlapping bubbles
  uniform vec3 uHighlight; // hover / selection ring
  uniform float uPx;       // one device pixel in CSS px

  varying vec2 vPos;
  varying float vRadius;
  varying vec4 vColor;
  varying float vHighlight;

  void main() {
    if (vRadius <= 0.05 || vColor.a <= 0.003) discard;
    float d = length(vPos);
    float aa = uPx * 0.9;
    float hiW = vHighlight * 2.0;
    float outerR = vRadius + hiW;
    float outer = 1.0 - smoothstep(outerR - aa, outerR + aa, d);
    if (outer <= 0.0) discard;
    float ringW = clamp(vRadius * 0.18, 0.0, 1.0);
    float fill = 1.0 - smoothstep(vRadius - ringW - aa, vRadius - ringW + aa, d);
    float inside = 1.0 - smoothstep(vRadius - aa, vRadius + aa, d);
    vec3 col = mix(uRing, vColor.rgb, fill);
    col = mix(col, mix(uHighlight, col, inside), vHighlight);
    gl_FragColor = vec4(col, vColor.a * outer);
  }
`;

export interface Transform {
  k: number;
  x: number;
  y: number;
}

/** Draws every bubble in one instanced draw call. */
export class Renderer {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry = new InstancedBufferGeometry();
  private material: ShaderMaterial;
  private mesh: Mesh;
  private capacity = 0;

  offset!: InstancedBufferAttribute;
  radius!: InstancedBufferAttribute;
  color!: InstancedBufferAttribute;
  highlight!: InstancedBufferAttribute;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.geometry.setAttribute('position', new BufferAttribute(quad, 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      // The vertex shader flips y (screen space is y-down), which reverses winding.
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTransform: { value: new Vector3(1, 0, 0) },
        uViewport: { value: new Vector2(1, 1) },
        uRing: { value: new Vector3(1, 1, 1) },
        uHighlight: { value: new Vector3(0, 0, 0) },
        uPx: { value: 1 / this.renderer.getPixelRatio() },
      },
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.ensureCapacity(0);
  }

  ensureCapacity(n: number) {
    if (n <= this.capacity && this.offset) {
      this.geometry.instanceCount = n;
      return;
    }
    this.capacity = Math.max(n, 16);
    const make = (size: number) => {
      const attr = new InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
      attr.setUsage(DynamicDrawUsage);
      return attr;
    };
    this.offset = make(2);
    this.radius = make(1);
    this.color = make(4);
    this.highlight = make(1);
    this.geometry.setAttribute('aOffset', this.offset);
    this.geometry.setAttribute('aRadius', this.radius);
    this.geometry.setAttribute('aColor', this.color);
    this.geometry.setAttribute('aHighlight', this.highlight);
    this.geometry.instanceCount = n;
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.material.uniforms.uViewport.value.set(width, height);
  }

  setTheme(surface: string, highlight: string) {
    this.renderer.setClearColor(new Color(surface), 1);
    // Shader colours are written straight to the sRGB framebuffer, so pass sRGB values.
    this.material.uniforms.uRing.value.set(...srgb(surface));
    this.material.uniforms.uHighlight.value.set(...srgb(highlight));
  }

  render(t: Transform) {
    this.material.uniforms.uTransform.value.set(t.k, t.x, t.y);
    this.offset.needsUpdate = true;
    this.radius.needsUpdate = true;
    this.color.needsUpdate = true;
    this.highlight.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    // Free the GL context right away (offscreen thumbnail engines come and go).
    this.renderer.forceContextLoss();
  }
}
