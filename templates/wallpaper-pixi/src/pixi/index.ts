// PixiJS on DesktopEngine: import pixi from here (`import * as PIXI from './pixi'`), not from 'pixi.js',
// so the engine is set up before pixi runs.

import { eventTarget, MouseEvent } from './globals';
import { DOMAdapter, extensions, browserExt } from 'pixi.js';
import type { Application } from 'pixi.js';
// the extensions pixi would load for a browser, minus the DOM ones (accessibility, DOM containers)
import 'pixi.js/webworker';
import 'pixi.js/events';

export * from 'pixi.js';

let context2D: DesktopEngine.CanvasRenderingContext2D | null = null;

DOMAdapter.set({
  createCanvas: (width?: number, height?: number) => {
    const canvas = new DesktopEngine.Canvas();
    if (width) canvas.width = width;
    if (height) canvas.height = height;
    return canvas;
  },
  createImage: () => new DesktopEngine.CanvasImage(),
  // pixi checks what the 2D context supports on its prototype
  getCanvasRenderingContext2D: () => {
    context2D ??= new DesktopEngine.Canvas().getContext('2d');
    return { prototype: Object.getPrototypeOf(context2D) };
  },
  getWebGLRenderingContext: () => WebGLRenderingContext,
  getNavigator: () => ({ userAgent: 'DesktopEngine', gpu: null }),
  // paths resolve against the package root, like DesktopEngine.fileSystemManager and CanvasImage
  getBaseUrl: () => '/',
  getFontFaceSet: () => null,
  // package files, or http(s) with the network permission in manifest.json
  fetch: (url: RequestInfo, init?: RequestInit) => fetch(url, init),
  parseXML: () => {
    throw new Error('parseXML is not supported on DesktopEngine');
  },
} as unknown as Parameters<typeof DOMAdapter.set>[0]);

// The browser environment would load its DOM extensions when an Application starts
extensions.remove(browserExt);

const POINTER_EVENTS = { mousedown: 'mousedown', mouseup: 'mouseup', mousemove: 'mousemove', mouseenter: 'mouseover', mouseleave: 'mouseout', wheel: 'wheel' } as const;
type PointerEventName = keyof typeof POINTER_EVENTS;
type PointerPayload = Partial<DesktopEngine.MousePayload & DesktopEngine.WheelPayload>;

/**
 * Feeds the mouse events of the app's canvas (or `source`, e.g. a window whose events arrive in the same coordinates)
 * to pixi's event system, so `eventMode` / `on('pointerdown')` work. Returns a function that injects an event by hand.
 */
export function bindPointerEvents(app: Application, source?: DesktopEngine.Canvas | DesktopEngine.Window) {
  const events = app.renderer.events;
  const view = app.canvas as unknown as DesktopEngine.Canvas;
  // a window's event map extends a component's
  const eventSource: DesktopEngine.EventedObject<DesktopEngine.ComponentEventMap> = source ?? view;
  let buttons = 0;
  // stands in for the DOM element: not in a document, so positions map against the drawing buffer
  const element = {
    ...eventTarget,
    isConnected: false,
    style: {},
    get width() { return view.width; },
    get height() { return view.height; },
  };
  const dispatch = (type: PointerEventName, payload: PointerPayload = {}): void => {
    if (type === 'mousedown') buttons = 1;
    if (type === 'mouseup') buttons = 0;
    const resolution = events.resolution;
    eventTarget.dispatchEvent(new MouseEvent(POINTER_EVENTS[type], {
      clientX: (payload.x ?? 0) * resolution,
      clientY: (payload.y ?? 0) * resolution,
      button: 0,
      buttons,
      ctrlKey: !!payload.ctrlKey, altKey: !!payload.altKey, metaKey: !!payload.metaKey, shiftKey: !!payload.shiftKey,
      deltaX: payload.deltaX ?? 0, deltaY: payload.deltaY ?? 0, deltaZ: payload.deltaZ ?? 0, deltaMode: 0,
      target: element,
    }));
  };
  events.setTargetElement(element as unknown as Parameters<typeof events.setTargetElement>[0]);
  for (const type of Object.keys(POINTER_EVENTS) as PointerEventName[]) {
    eventSource.addEventListener(type, (payload: unknown) => dispatch(type, payload as PointerPayload));
  }
  return dispatch;
}
