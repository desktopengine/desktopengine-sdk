// Dynamic wallpaper drawn with PixiJS: soft lights drifting up the desktop in three layers; the nearer a layer, the bigger
// and faster its lights and the more it follows the mouse. The background fades between light and dark with the
// system appearance.
// Install PixiJS first (npm install); esbuild bundles it into index.js. ./pixi sets it up for DesktopEngine.
// Debug: desktopengine dev . --param color=#FF6B5E --param appearance=light

import * as PIXI from './pixi';

const options = DesktopEngine.launchOptions;
const parameters = options.parameters ?? {};
const color = typeof parameters.color === 'string' ? parameters.color : '#5E8BFF';
const parallax = parameters.parallax !== false;
// 'auto' follows the system appearance, 'light' / 'dark' stay put
const appearance = typeof parameters.appearance === 'string' ? parameters.appearance : 'auto';

/** Background and how the lights blend: additive glows on dark, plain translucent discs on light */
const DARK = new PIXI.Color('#0B1020');
const LIGHT = new PIXI.Color('#E8EDF6');

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

/** A soft round light, drawn once with a radial gradient and shared by every sprite */
function lightTexture(size: number): PIXI.Texture {
  const source = new DesktopEngine.Canvas();
  source.width = size;
  source.height = size;
  const context = source.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.45)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return PIXI.Texture.from(source as unknown as PIXI.TextureSourceLike);
}

interface Light {
  sprite: PIXI.Sprite;
  speed: number;
  sway: number;
  phase: number;
}

async function main(): Promise<void> {
  const app = new PIXI.Application();
  // A wallpaper is never transparent, and an opaque canvas composites with less power
  await app.init({
    canvas: canvas as unknown as PIXI.ICanvas,
    width,
    height,
    resolution: win.devicePixelRatio,
    antialias: true,
    background: DARK,
    preference: 'webgl',
  });

  const texture = lightTexture(256);
  const tint = new PIXI.Color(color);
  // far to near: size of the lights, how fast they rise, how much the layer follows the mouse
  const layers = [
    { count: 40, size: 40, speed: 12, depth: 12, alpha: 0.35 },
    { count: 24, size: 90, speed: 24, depth: 30, alpha: 0.5 },
    { count: 10, size: 180, speed: 40, depth: 60, alpha: 0.6 },
  ].map((layer) => {
    const container = new PIXI.Container();
    app.stage.addChild(container);
    const lights: Light[] = [];
    for (let i = 0; i < layer.count; i++) {
      const sprite = new PIXI.Sprite({ texture, anchor: 0.5, tint, alpha: layer.alpha * (0.6 + Math.random() * 0.4) });
      sprite.width = sprite.height = layer.size * (0.7 + Math.random() * 0.6);
      sprite.position.set(Math.random() * width, Math.random() * height);
      container.addChild(sprite);
      lights.push({ sprite, speed: layer.speed * (0.7 + Math.random() * 0.6), sway: 10 + Math.random() * 30, phase: Math.random() * Math.PI * 2 });
    }
    return { ...layer, container, lights };
  });

  // Mouse parallax: the desktop window gets mousemove while the pointer is over the desktop
  const target = new PIXI.Point();
  const lean = new PIXI.Point();
  if (parallax) {
    win.onmousemove = (event) => {
      target.set((event.x / width - 0.5) * 2, (event.y / height - 0.5) * 2);
    };
  }

  let lightness = targetLightness();
  const background = new PIXI.Color();
  // The ticker runs on requestAnimationFrame, which stops while the app pauses content
  app.ticker.add((ticker) => {
    const elapsed = ticker.deltaMS;
    const seconds = ticker.lastTime / 1000;
    // Ease toward the targets, so the lean and a change of appearance are smooth
    const ease = 1 - Math.exp(-elapsed / 600);
    lean.set(lean.x + (target.x - lean.x) * ease, lean.y + (target.y - lean.y) * ease);
    lightness += (targetLightness() - lightness) * ease;

    const [dr, dg, db] = DARK.toArray();
    const [lr, lg, lb] = LIGHT.toArray();
    background.setValue([dr + (lr - dr) * lightness, dg + (lg - dg) * lightness, db + (lb - db) * lightness]);
    app.renderer.background.color = background;
    const blendMode = lightness < 0.5 ? 'add' : 'normal';

    for (const layer of layers) {
      layer.container.position.set(-lean.x * layer.depth, -lean.y * layer.depth);
      layer.container.blendMode = blendMode;
      for (const light of layer.lights) {
        const { sprite } = light;
        sprite.y -= light.speed * elapsed / 1000;
        // back to the bottom once it leaves the top
        if (sprite.y < -sprite.height) {
          sprite.y = height + sprite.height;
          sprite.x = Math.random() * width;
        }
        sprite.x += Math.sin(seconds * 0.5 + light.phase) * light.sway * elapsed / 1000;
      }
    }
  });
}

main().catch((error: Error) => console.error(error.stack ?? String(error)));
