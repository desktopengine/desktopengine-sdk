// The few browser globals PixiJS reads, some already while its modules load, so this module runs before pixi.js
// (./index.ts imports it first). DesktopEngine has no DOM: these are stand-ins, not a DOM implementation.

const global = globalThis as unknown as Record<string, unknown>;

type Listener = (event: { type: string }) => void;
const listeners = new Map<string, Listener[]>();

/** addEventListener / removeEventListener / dispatchEvent of the stand-in `window`, `document` and the pointer bridge */
export const eventTarget = {
  addEventListener(type: string, listener: Listener): void {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  },
  removeEventListener(type: string, listener: Listener): void {
    listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
  },
  dispatchEvent(event: { type: string }): boolean {
    (listeners.get(event.type) ?? []).forEach((listener) => listener(event));
    return true;
  },
};

/** What pixi's EventSystem expects of a mouse event */
export class MouseEvent {
  type: string;

  constructor(type: string, init: Record<string, unknown> = {}) {
    Object.assign(this, init);
    this.type = type;
  }

  preventDefault(): void {}
  stopPropagation(): void {}
}

global.navigator ??= { userAgent: 'DesktopEngine' };
global.document ??= {
  ...eventTarget,
  // the render target system asks whether the view canvas is on screen
  body: { contains: () => true },
  // Assets probes the video formats with a <video>
  createElement: (tag: string) => (tag === 'canvas' ? new DesktopEngine.Canvas() : { canPlayType: () => '' }),
};
global.addEventListener ??= eventTarget.addEventListener;
global.removeEventListener ??= eventTarget.removeEventListener;
global.MouseEvent ??= MouseEvent;
// pixi recognizes texture sources with instanceof
global.HTMLCanvasElement ??= DesktopEngine.Canvas;
global.HTMLImageElement ??= DesktopEngine.CanvasImage;
