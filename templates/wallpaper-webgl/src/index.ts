// Dynamic wallpaper: a lit cube turning slowly on the desktop, drawn with WebGL 2, leaning a little toward the mouse.
// The background fades between light and dark with the system appearance.
// cube.ts is the geometry; this file makes the window, the shaders and the frames.
// Debug: desktopengine dev . --param color=#FF6B5E --param appearance=light

import { vertices, indices } from './cube';

const options = DesktopEngine.launchOptions;
const parameters = options.parameters ?? {};
const color = hexToRGB(typeof parameters.color === 'string' ? parameters.color : '#5E8BFF');
const parallax = parameters.parallax !== false;
// 'auto' follows the system appearance, 'light' / 'dark' stay put
const appearance = typeof parameters.appearance === 'string' ? parameters.appearance : 'auto';

/** Background and ambient light for dark and light; a light background needs more ambient light */
const DARK = { background: [0.043, 0.063, 0.125], ambient: 0.25 };
const LIGHT = { background: [0.91, 0.93, 0.965], ambient: 0.45 };

function hexToRGB(hex: string): number[] {
  const value = parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function targetLightness(): number {
  if (appearance === 'light') return 1;
  if (appearance === 'dark') return 0;
  return DesktopEngine.system.appearance === 'light' ? 1 : 0;
}

const VERTEX_SHADER = `#version 300 es
  layout(location = 0) in vec3 position;
  layout(location = 1) in vec3 normal;
  uniform mat4 model;
  uniform mat4 projection;
  out vec3 vNormal;
  void main() {
    vNormal = mat3(model) * normal;
    gl_Position = projection * model * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision mediump float;
  uniform vec3 color;
  uniform float ambient;
  in vec3 vNormal;
  out vec4 fragColor;
  void main() {
    vec3 light = normalize(vec3(0.4, 0.8, 0.6));
    float diffuse = max(dot(normalize(vNormal), light), 0.0);
    fragColor = vec4(color * (ambient + (1.0 - ambient) * diffuse), 1.0);
  }
`;

function compile(gl: DesktopEngine.WebGL2RenderingContext, type: number, source: string): DesktopEngine.WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'compile failed');
  return shader;
}

// The display the app picked, otherwise the main display
const screen = DesktopEngine.ScreenManager.screens.find((item) => item.identifier === options.display?.id)
  ?? DesktopEngine.ScreenManager.mainScreen;
const { x, y, width, height } = screen.bounds;

const win = new DesktopEngine.Window({ type: 'desktop', style: { left: x, top: y, width, height, backgroundColor: '#0B1020' } });
const canvas = new DesktopEngine.Canvas({ style: { flex: 1 } });
win.appendChild(canvas);
win.show();

canvas.width = Math.round(width * win.devicePixelRatio);
canvas.height = Math.round(height * win.devicePixelRatio);
// A wallpaper is never transparent, and an opaque canvas composites with less power
const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
if (!context) throw new Error('WebGL 2 is not available');
const gl = context;

const program = gl.createProgram();
if (!program) throw new Error('createProgram failed');
gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
gl.linkProgram(program);
gl.useProgram(program);

// The cube's buffers, described once in a vertex array: location 0 is the position, 1 the normal
gl.bindVertexArray(gl.createVertexArray());
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

const modelLocation = gl.getUniformLocation(program, 'model');
const ambientLocation = gl.getUniformLocation(program, 'ambient');
gl.uniform3fv(gl.getUniformLocation(program, 'color'), color);

// Perspective projection, 45° vertical field of view
const aspect = width / height;
const f = 1 / Math.tan(Math.PI / 8);
const near = 0.1;
const far = 100;
gl.uniformMatrix4fv(gl.getUniformLocation(program, 'projection'), false, [
  f / aspect, 0, 0, 0,
  0, f, 0, 0,
  0, 0, (far + near) / (near - far), -1,
  0, 0, (2 * far * near) / (near - far), 0,
]);
gl.enable(gl.DEPTH_TEST);
gl.viewport(0, 0, canvas.width, canvas.height);

// Mouse parallax: the desktop window gets mousemove while the pointer is over the desktop
let target = [0, 0];
let lean = [0, 0];
if (parallax) {
  win.onmousemove = (event) => {
    target = [(event.x / width - 0.5) * 2, (event.y / height - 0.5) * 2];
  };
}

let lightness = targetLightness();
let lastTime = 0;

// requestAnimationFrame stops while the app pauses content (on battery, behind a full-screen app)
function draw(time: number): void {
  const elapsed = lastTime ? time - lastTime : 0;
  lastTime = time;
  // Ease toward the targets, so the lean and a change of appearance are smooth
  const ease = 1 - Math.exp(-elapsed / 600);
  lean = lean.map((value, index) => value + (target[index] - value) * ease);
  lightness += (targetLightness() - lightness) * ease;

  // Turn a around y and b around x, then move it back to z = -8
  const a = time / 4000 + lean[0] * 0.3;
  const b = time / 6000 + lean[1] * 0.3;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  gl.uniformMatrix4fv(modelLocation, false, [
    ca, sa * sb, -sa * cb, 0,
    0, cb, sb, 0,
    sa, -ca * sb, ca * cb, 0,
    lean[0] * 0.4, -lean[1] * 0.4, -8, 1,
  ]);
  gl.uniform1f(ambientLocation, DARK.ambient + (LIGHT.ambient - DARK.ambient) * lightness);

  const [red, green, blue] = DARK.background.map((value, index) => value + (LIGHT.background[index] - value) * lightness);
  gl.clearColor(red, green, blue, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);
