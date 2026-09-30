// Dynamic widget: how much of today has passed. Size, position, level and parameters come from
// DesktopEngine.launchOptions, set by the user in the inspector of the Widgets page; parameters the user changes later
// come with parameterschange. When the window is dragged, the widget tells the app its position, which comes back on
// the next launch.
// Debug: desktopengine dev . --size medium --param accent=#FF9F0A

import { dayProgress, formatRemaining } from './progress';

const options = DesktopEngine.launchOptions;
let accent = '#0A84FF';
let workday = false;
let appearance = 'auto';
function readParameters(parameters: Readonly<Record<string, DesktopEngine.ParameterValue>>): void {
  accent = typeof parameters.accent === 'string' ? parameters.accent : '#0A84FF';
  workday = parameters.workday === true;
  appearance = typeof parameters.appearance === 'string' ? parameters.appearance : 'auto';
}
readParameters(options.parameters ?? {});
// The text drawn on the canvas follows the user's language, the same as the translations in manifest.json
const chinese = (options.locale ?? '').startsWith('zh-Hans');

// Without launch options (e.g. loaded from the Develop menu): small, at the top left of the screen
const width = options.width ?? 164;
const height = options.height ?? 164;
const position = options.position ?? { x: 40, y: 80 };
const isMedium = width > height;

const win = new DesktopEngine.Window({
  type: options.windowType ?? 'widget',
  style: { left: position.x, top: position.y, width, height },
});
const canvas = new DesktopEngine.Canvas({ style: { flex: 1 } });
win.appendChild(canvas);
win.show();

// Remember where the user dragged it
win.onmove = (payload) => {
  postMessage('host', { type: 'move', x: payload.x, y: payload.y });
};

const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is not available');

/** Sizes the canvas to the display's scale, and again after the widget is dragged to a display with another one */
function fitCanvas(ctx: DesktopEngine.CanvasRenderingContext2D): void {
  const scale = win.devicePixelRatio;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  // Changing the size keeps the context's transform here (a browser resets it), so it's set rather than scaled
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}
fitCanvas(context);
// Dragged onto a display with another scale
win.ondevicepixelratiochange = () => {
  fitCanvas(context);
  draw(context);
};

const palettes = {
  dark: { background: '#1C1C1E', track: 'rgba(255,255,255,0.12)', label: 'rgba(255,255,255,0.85)', secondary: 'rgba(255,255,255,0.55)' },
  light: { background: '#FFFFFF', track: 'rgba(0,0,0,0.08)', label: 'rgba(0,0,0,0.85)', secondary: 'rgba(0,0,0,0.5)' },
};
// "auto" follows the system appearance (DesktopEngine.system.appearance) and redraws when it changes
function currentColors(): (typeof palettes)['dark'] {
  return palettes[appearance === 'light' || appearance === 'dark' ? appearance : DesktopEngine.system.appearance];
}
DesktopEngine.system.onappearancechange = () => draw(context);
// The user changed an option in the inspector: apply it, and the app doesn't restart the widget
DesktopEngine.system.onparameterschange = (event) => {
  readParameters(event.parameters);
  draw(context);
};

/** Rounded rectangle path (styles don't support rounded corners, so they're drawn on the canvas; the window is transparent) */
function roundedRect(ctx: DesktopEngine.CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(ctx: DesktopEngine.CanvasRenderingContext2D): void {
  const { fraction, remaining } = dayProgress(new Date(), workday);
  const colors = currentColors();

  ctx.clearRect(0, 0, width, height);
  roundedRect(ctx, 0, 0, width, height, 22);
  ctx.fillStyle = colors.background;
  ctx.fill();

  const ringSize = Math.min(height, isMedium ? height : width) - 44;
  const cx = isMedium ? 22 + ringSize / 2 : width / 2;
  const cy = height / 2;
  const radius = ringSize / 2;

  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.track;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(fraction, 0.001));
  ctx.stroke();

  ctx.fillStyle = colors.label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px Helvetica';
  ctx.fillText(`${Math.round(fraction * 100)}%`, cx, cy);

  if (isMedium) {
    const left = cx + radius + 24;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.secondary;
    ctx.font = '13px Helvetica';
    const title = chinese ? (workday ? '今天的工作时间' : '今天') : (workday ? 'Working Hours Today' : 'Today');
    ctx.fillText(title, left, cy - 22);
    ctx.fillStyle = colors.label;
    ctx.font = 'bold 22px Helvetica';
    ctx.fillText(formatRemaining(remaining, chinese), left, cy + 8);
  }
}

// Once a minute is enough, no animation running all the time
draw(context);
setInterval(() => draw(context), 60 * 1000);
