/**
 * Chroma key for clips and stills: pixels close to the key colour become
 * transparent, with a soft edge, and the key colour's tint is taken out of
 * what stays (spill). It runs as a frame reaches the compositor, after the
 * colour look, so the preview and the export key the same pixels.
 * (eVoice Studio addition to the vendored OpenCut renderer.)
 *
 * One WebGL2 context does the work for every clip; where WebGL2 is missing
 * the same formula runs on the CPU.
 */
import type { ParamValues } from './vendor/params';

export interface ChromaKey {
  /** Key colour as 0..1 RGB. */
  color: [number, number, number];
  /** Chroma distance below which a pixel is fully transparent (0..1). */
  threshold: number;
  /** Width of the soft edge above the threshold (0..1). */
  softness: number;
  /** How much of the key colour's tint is removed from what stays (0..1). */
  spill: number;
}

export const DEFAULT_KEY_COLOR = '#00ff00';
export const DEFAULT_THRESHOLD = 0.25;
export const DEFAULT_SOFTNESS = 0.1;
export const DEFAULT_SPILL = 0.5;

const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match ? Number.parseInt(match[1], 16) : 0x00ff00;
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** The key an element asks for, or null when keying is off. */
export function chromaKeyFor(params: ParamValues): ChromaKey | null {
  if (params['chroma.enabled'] !== true) return null;
  return {
    color: hexToRgb(typeof params['chroma.color'] === 'string' ? params['chroma.color'] : DEFAULT_KEY_COLOR),
    threshold: Math.min(1, Math.max(0, number(params['chroma.threshold'], DEFAULT_THRESHOLD))),
    softness: Math.min(1, Math.max(0, number(params['chroma.softness'], DEFAULT_SOFTNESS))),
    spill: Math.min(1, Math.max(0, number(params['chroma.spill'], DEFAULT_SPILL))),
  };
}

/** A stable text form of a key, for texture revisions. */
export const chromaKeyId = (key: ChromaKey | null | undefined): string =>
  key ? `${key.color.map((c) => c.toFixed(4)).join(',')}:${key.threshold}:${key.softness}:${key.spill}` : '';

/** Blue- and red-difference chroma (BT.601), each about −0.5..0.5. */
const chroma = (r: number, g: number, b: number): [number, number] => [
  -0.168736 * r - 0.331264 * g + 0.5 * b,
  0.5 * r - 0.418688 * g - 0.081312 * b,
];

const smoothstep = (edge0: number, edge1: number, x: number) => {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * One pixel through the key (0..1 RGB in, straight RGB and alpha out). The
 * shader below is the same formula.
 */
export function keyPixel(r: number, g: number, b: number, key: ChromaKey): [number, number, number, number] {
  const [kb, kr] = chroma(...key.color);
  const [pb, pr] = chroma(r, g, b);
  // Distance in the chroma plane, scaled so the farthest colours are about 1.
  const distance = Math.hypot(pb - kb, pr - kr) / 0.7071;
  const alpha = smoothstep(key.threshold, key.threshold + key.softness, distance);
  // Spill: the key's strongest channel may not stand above the other two.
  const out: [number, number, number] = [r, g, b];
  const dominant = key.color.indexOf(Math.max(...key.color));
  const others = out.filter((_, index) => index !== dominant);
  const limit = Math.max(...others);
  if (out[dominant] > limit) out[dominant] -= (out[dominant] - limit) * key.spill;
  return [out[0], out[1], out[2], alpha];
}

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D source;
uniform vec3 keyColor;
uniform float threshold;
uniform float softness;
uniform float spill;
uniform int dominant;
out vec4 color;
vec2 chroma(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
float step2(float e0, float e1, float x) {
  if (e1 <= e0) return x < e0 ? 0.0 : 1.0;
  return smoothstep(e0, e1, x);
}
void main() {
  vec4 texel = texture(source, uv);
  // Straight colour from the premultiplied upload.
  vec3 c = texel.a > 0.0 ? texel.rgb / texel.a : vec3(0.0);
  float distance = length(chroma(c) - chroma(keyColor)) / 0.7071;
  float alpha = step2(threshold, threshold + softness, distance) * texel.a;
  float limit = dominant == 0 ? max(c.g, c.b) : dominant == 1 ? max(c.r, c.b) : max(c.r, c.g);
  if (dominant == 0 && c.r > limit) c.r -= (c.r - limit) * spill;
  if (dominant == 1 && c.g > limit) c.g -= (c.g - limit) * spill;
  if (dominant == 2 && c.b > limit) c.b -= (c.b - limit) * spill;
  color = vec4(c * alpha, alpha);
}`;

interface Gl {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  uniforms: Record<'keyColor' | 'threshold' | 'softness' | 'spill' | 'dominant', WebGLUniformLocation | null>;
}

let shared: Gl | null | undefined;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** The one WebGL2 context keying uses (browsers cap how many a page may hold), or null. */
function sharedGl(): Gl | null {
  if (shared !== undefined) return shared;
  shared = null;
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(16, 16);
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    shared = {
      canvas,
      gl,
      program,
      texture,
      uniforms: {
        keyColor: uniform('keyColor'),
        threshold: uniform('threshold'),
        softness: uniform('softness'),
        spill: uniform('spill'),
        dominant: uniform('dominant'),
      },
    };
  } catch {
    shared = null;
  }
  return shared;
}

function keyOnGpu(target: OffscreenCanvas, source: CanvasImageSource, width: number, height: number, key: ChromaKey): boolean {
  const context = sharedGl();
  if (!context) return false;
  const { gl, canvas, uniforms } = context;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  gl.useProgram(context.program);
  gl.bindTexture(gl.TEXTURE_2D, context.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  gl.uniform3f(uniforms.keyColor, ...key.color);
  gl.uniform1f(uniforms.threshold, key.threshold);
  gl.uniform1f(uniforms.softness, key.softness);
  gl.uniform1f(uniforms.spill, key.spill);
  gl.uniform1i(uniforms.dominant, key.color.indexOf(Math.max(...key.color)));
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const context2d = target.getContext('2d')!;
  context2d.clearRect(0, 0, width, height);
  context2d.drawImage(canvas, 0, 0);
  return true;
}

function keyOnCpu(target: OffscreenCanvas, source: CanvasImageSource, width: number, height: number, key: ChromaKey): void {
  const context = target.getContext('2d', { willReadFrequently: true })!;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = keyPixel(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, key);
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
    data[i + 3] = Math.round(a * data[i + 3]);
  }
  context.putImageData(image, 0, 0);
}

const keyed = new Map<string, OffscreenCanvas>();

/**
 * Keys `source` into a canvas kept per texture id. Returns the source itself
 * when there is no key.
 */
export function applyChromaKey(
  textureId: string,
  source: CanvasImageSource,
  width: number,
  height: number,
  key: ChromaKey | null | undefined,
): CanvasImageSource {
  if (!key) {
    keyed.delete(textureId);
    return source;
  }
  let target = keyed.get(textureId);
  if (!target || target.width !== width || target.height !== height) {
    target = new OffscreenCanvas(width, height);
    keyed.set(textureId, target);
  }
  if (!keyOnGpu(target, source, width, height, key)) keyOnCpu(target, source, width, height, key);
  return target;
}
