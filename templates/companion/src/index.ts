// Desktop companion: a round little creature in a transparent window above other windows. It strolls back and forth,
// rests now and then, hops when clicked and stays wherever it's dragged; the app starts it there next time.
// It only redraws when something changes, so it costs nothing while it rests.
// Debug: desktopengine dev . --param color=#7ED957 --param speed=4

const options = DesktopEngine.launchOptions;
let color = '#FF9F43';
let speed = 2;
function readParameters(parameters: Readonly<Record<string, DesktopEngine.ParameterValue>>): void {
  color = typeof parameters.color === 'string' ? parameters.color : '#FF9F43';
  speed = typeof parameters.speed === 'number' ? parameters.speed : 2;
}
readParameters(options.parameters ?? {});

/** Window size and body radius, in points */
const SIZE = 72;
const RADIUS = 24;

// Where it walks: the display the app gives without the menu bar and the Dock, otherwise the main display
const area = options.display?.visibleFrame ?? DesktopEngine.ScreenManager.mainScreen.bounds;
let x = options.position?.x ?? area.x + (area.width - SIZE) / 2;
let y = options.position?.y ?? area.y + area.height - SIZE;

const win = new DesktopEngine.Window({
  type: options.windowType ?? 'overlay',
  style: { left: Math.round(x), top: Math.round(y), width: SIZE, height: SIZE },
});
const canvas = new DesktopEngine.Canvas({ style: { flex: 1 } });
win.appendChild(canvas);
win.show();

const context2d = canvas.getContext('2d');
if (!context2d) throw new Error('Canvas 2D is not available');
const context = context2d;

/** Sizes the canvas to the display's scale, and again after the creature goes to a display with another one */
function fitCanvas(): void {
  const ratio = win.devicePixelRatio;
  canvas.width = SIZE * ratio;
  canvas.height = SIZE * ratio;
  // Changing the size keeps the context's transform here (a browser resets it), so it's set rather than scaled
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}
fitCanvas();

let direction = 1;
let walking = false;
/** When to switch between walking and resting, when the last hop started and the next blink starts (milliseconds) */
let switchAt = 0;
let hopAt = -Infinity;
let blinkAt = 3000;
/** When the user last dragged it: it holds still meanwhile */
let draggedAt = -Infinity;
let step = 0;
let lastTime = 0;
let windowX = Math.round(x);
let reportTimer: number | null = null;
/** What was drawn last, to skip frames where nothing changed */
let drawn = '';

/** Fills an oval: Canvas 2D here has arc but no ellipse, so squash a circle */
function oval(cx: number, cy: number, rx: number, ry: number, fill: string): void {
  context.save();
  context.translate(cx, cy);
  context.scale(rx, ry);
  context.fillStyle = fill;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function render(hop: number, blinking: boolean): void {
  context.clearRect(0, 0, SIZE, SIZE);
  const cx = SIZE / 2;
  const ground = SIZE - 4;
  // Bobbing while it walks, stretched in the air
  const bob = walking ? Math.abs(Math.sin(step)) * 2 : 0;
  const stretch = hop > 0 ? 1.08 : 1 - bob * 0.02;
  const cy = ground - RADIUS * stretch - hop - bob;

  // Shadow, smaller the higher it is
  oval(cx, ground, RADIUS * (0.9 - hop / 80), 3, 'rgba(0,0,0,0.18)');
  oval(cx, cy, RADIUS / stretch, RADIUS * stretch, color);
  // Only the body takes the mouse: clicks and drags beside it reach whatever is below
  win.hitRegion = [{ x: cx - RADIUS / stretch, y: cy - RADIUS * stretch, width: (RADIUS * 2) / stretch, height: RADIUS * 2 * stretch }];

  // Eyes look where it's going
  const look = walking ? direction * 4 : 0;
  for (const side of [-1, 1]) {
    const ex = cx + side * 8 + look;
    const ey = cy - 4;
    oval(ex, ey, 5, blinking ? 1 : 6, '#FFFFFF');
    if (!blinking) oval(ex + look / 2, ey + 1, 2.5, 2.5, '#2B2B2B');
  }
}

// Click: hop
canvas.onclick = () => {
  hopAt = performance.now();
};

// Dragging moves the window natively. Tell the user's moves from our own, and remember the spot once it settles
win.onmove = (position) => {
  if (Math.abs(position.x - windowX) <= 1 && Math.abs(position.y - Math.round(y)) <= 1) return;
  x = position.x;
  windowX = position.x;
  y = position.y;
  draggedAt = performance.now();
  if (reportTimer !== null) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => postMessage('host', { type: 'move', x: Math.round(x), y: Math.round(y) }), 400);
};

// Driven by requestAnimationFrame: the app pauses it on battery and behind full-screen apps, and the creature stops too
function frame(time: number): void {
  const elapsed = lastTime ? Math.min(time - lastTime, 100) : 0;
  lastTime = time;

  if (time > switchAt) {
    walking = !walking;
    if (walking && Math.random() < 0.5) direction = -direction;
    switchAt = time + (walking ? 4000 + Math.random() * 5000 : 2000 + Math.random() * 3000);
  }
  if (time - blinkAt > 140) blinkAt += 2500 + Math.random() * 4000;

  const moving = walking && time - draggedAt > 800;
  if (moving) {
    x += direction * speed * 12 * (elapsed / 1000);
    // Turn around at the edges of the display
    const left = area.x;
    const right = area.x + area.width - SIZE;
    if (x < left || x > right) {
      x = Math.min(right, Math.max(left, x));
      direction = -direction;
    }
    step += (elapsed / 1000) * speed * 3;
    if (Math.round(x) !== windowX) {
      windowX = Math.round(x);
      win.style.left = windowX;
    }
  }

  const hopProgress = (time - hopAt) / 450;
  const hop = hopProgress >= 0 && hopProgress <= 1 ? 22 * 4 * hopProgress * (1 - hopProgress) : 0;
  const blinking = time >= blinkAt && time - blinkAt < 140;
  // Only redraw when the picture changes
  const picture = `${walking ? Math.round(step * 20) : 'rest'} ${direction} ${Math.round(hop)} ${blinking}`;
  if (picture !== drawn) {
    drawn = picture;
    render(hop, blinking);
  }

  requestAnimationFrame(frame);
}

// Walked or dragged onto a display with another scale: the next frame draws again
win.ondevicepixelratiochange = () => {
  fitCanvas();
  drawn = '';
};

// The user changed an option: it goes on where it is with the new color and speed, the app doesn't restart it
DesktopEngine.system.onparameterschange = (event) => {
  readParameters(event.parameters);
  drawn = '';
};

requestAnimationFrame(frame);

// A module, not a global script: keeps these names out of the other templates when they are checked together
export {};
