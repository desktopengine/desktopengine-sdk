// Dynamic wallpaper: soft patches of color drifting over a gradient, drawn with Canvas 2D.
// Each display gets a desktop-level window; the colors fade between light and dark with the system appearance.
// Debug: desktopengine dev . --param speed=3 --param appearance=dark

const options = DesktopEngine.launchOptions;
const parameters = options.parameters ?? {};
const speed = typeof parameters.speed === 'number' ? parameters.speed : 1;
// 'auto' follows the system appearance, 'light' / 'dark' stay put
const appearance = typeof parameters.appearance === 'string' ? parameters.appearance : 'auto';

type RGB = [number, number, number];

/** Light and dark palettes: the top and bottom of the background, and the drifting patches */
const LIGHT = { top: [246, 214, 196] as RGB, bottom: [201, 214, 242] as RGB, patches: [[255, 168, 128], [196, 160, 255], [120, 200, 255]] as RGB[] };
const DARK = { top: [20, 26, 51] as RGB, bottom: [42, 31, 77] as RGB, patches: [[92, 70, 200], [40, 140, 170], [170, 60, 140]] as RGB[] };

function targetLightness(): number {
  if (appearance === 'light') return 1;
  if (appearance === 'dark') return 0;
  return DesktopEngine.system.appearance === 'light' ? 1 : 0;
}

function mix(a: RGB, b: RGB, t: number): string {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t)).join(',');
}

// Only the display the app picked, otherwise every display
const screens = DesktopEngine.ScreenManager.screens.filter((screen) => !options.display || screen.identifier === options.display.id);

const scenes = screens.map((screen) => {
  const { x, y, width, height } = screen.bounds;
  const win = new DesktopEngine.Window({ type: 'desktop', style: { left: x, top: y, width, height, backgroundColor: '#000000' } });
  const canvas = new DesktopEngine.Canvas({ style: { flex: 1 } });
  win.appendChild(canvas);
  win.show();

  // Draw in pixels, not points, so it stays sharp on Retina displays
  const scale = win.devicePixelRatio;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  // A wallpaper is never transparent, and an opaque canvas composites with less power
  const context = canvas.getContext('2d', { alpha: false });
  context?.scale(scale, scale);
  return { context, width, height };
});

let lightness = targetLightness();
let lastTime = 0;

// requestAnimationFrame stops while the app pauses content (on battery, behind a full-screen app)
function draw(time: number): void {
  // Ease toward the target, so a change of the system appearance fades over a couple of seconds
  const elapsed = lastTime ? time - lastTime : 0;
  lastTime = time;
  lightness += (targetLightness() - lightness) * (1 - Math.exp(-elapsed / 600));

  const t = (time / 1000) * speed * 0.1;
  for (const { context, width, height } of scenes) {
    if (!context) continue;
    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, `rgb(${mix(DARK.top, LIGHT.top, lightness)})`);
    background.addColorStop(1, `rgb(${mix(DARK.bottom, LIGHT.bottom, lightness)})`);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    // Each patch drifts along its own slow curve
    LIGHT.patches.forEach((light, index) => {
      const color = mix(DARK.patches[index], light, lightness);
      const cx = width * (0.5 + 0.32 * Math.sin(t * (1 + index * 0.27) + index * 2.1));
      const cy = height * (0.5 + 0.3 * Math.cos(t * (0.8 + index * 0.19) + index * 1.3));
      const radius = Math.max(width, height) * (0.38 + 0.06 * Math.sin(t * 0.7 + index));
      const patch = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
      patch.addColorStop(0, `rgba(${color},0.55)`);
      patch.addColorStop(1, `rgba(${color},0)`);
      context.fillStyle = patch;
      context.fillRect(0, 0, width, height);
    });
  }
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);

// A module, not a global script: keeps these names out of the other templates when they are checked together
export {};
