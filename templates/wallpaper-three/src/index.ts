// Dynamic wallpaper drawn with three.js: a glossy knot turning slowly on the desktop, leaning a little toward the mouse.
// The background fades between light and dark with the system appearance.
// Install three.js first (npm install); esbuild bundles it into index.js. Import it from ./three, which sets it up for DesktopEngine.
// Debug: desktopengine dev . --param color=#FF6B5E --param appearance=light

import * as THREE from './three';

const options = DesktopEngine.launchOptions;
const parameters = options.parameters ?? {};
const color = typeof parameters.color === 'string' ? parameters.color : '#5E8BFF';
const parallax = parameters.parallax !== false;
// 'auto' follows the system appearance, 'light' / 'dark' stay put
const appearance = typeof parameters.appearance === 'string' ? parameters.appearance : 'auto';

/** Background and ambient light for dark and light; a light background needs more ambient light */
const DARK = { background: new THREE.Color('#0B1020'), ambient: 0.35 };
const LIGHT = { background: new THREE.Color('#E8EDF6'), ambient: 0.9 };

function targetLightness(): number {
  if (appearance === 'light') return 1;
  if (appearance === 'dark') return 0;
  return DesktopEngine.system.appearance === 'light' ? 1 : 0;
}

// The display the app picked, otherwise the main display
const screen = DesktopEngine.ScreenManager.screens.find((item) => item.identifier === options.display?.id)
  ?? DesktopEngine.ScreenManager.mainScreen;
const { x, y, width, height } = screen.bounds;

const win = new DesktopEngine.Window({ type: 'desktop', style: { left: x, top: y, width, height, backgroundColor: '#0B1020' } });
const canvas = new DesktopEngine.Canvas({ style: { flex: 1 } });
win.appendChild(canvas);
win.show();

// three.js draws into the engine's canvas (it would create one with `document` otherwise);
// a wallpaper is never transparent, and an opaque canvas composites with less power
type RendererCanvas = NonNullable<THREE.WebGLRendererParameters['canvas']>;
const renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as RendererCanvas, antialias: true, alpha: false });
renderer.setPixelRatio(win.devicePixelRatio);
// false: the canvas' style already sizes it, only set the drawing buffer
renderer.setSize(width, height, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
camera.position.set(0, 0, 8);

const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.32, 200, 32),
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 }),
);
scene.add(knot);

const ambient = new THREE.HemisphereLight('#ffffff', '#445066', DARK.ambient);
scene.add(ambient);
const key = new THREE.DirectionalLight('#ffffff', 2.5);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight('#9DB8FF', 1.5);
rim.position.set(-4, -2, -3);
scene.add(rim);

// Mouse parallax: the desktop window gets mousemove while the pointer is over the desktop
const target = new THREE.Vector2();
const lean = new THREE.Vector2();
if (parallax) {
  win.onmousemove = (event) => {
    target.set((event.x / width - 0.5) * 2, (event.y / height - 0.5) * 2);
  };
}

const background = new THREE.Color();
scene.background = background;
let lightness = targetLightness();
let lastTime = 0;

// requestAnimationFrame stops while the app pauses content (on battery, behind a full-screen app)
function draw(time: number): void {
  const elapsed = lastTime ? time - lastTime : 0;
  lastTime = time;
  // Ease toward the targets, so the lean and a change of appearance are smooth
  const ease = 1 - Math.exp(-elapsed / 600);
  lean.lerp(target, ease);
  lightness += (targetLightness() - lightness) * ease;

  knot.rotation.set(time / 6000 + lean.y * 0.3, time / 4000 + lean.x * 0.3, 0);
  knot.position.set(lean.x * 0.4, -lean.y * 0.4, 0);
  background.copy(DARK.background).lerp(LIGHT.background, lightness);
  ambient.intensity = DARK.ambient + (LIGHT.ambient - DARK.ambient) * lightness;

  renderer.render(scene, camera);
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);
