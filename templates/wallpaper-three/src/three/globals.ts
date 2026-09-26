// The browser globals three.js reads. DesktopEngine has no DOM: these are stand-ins, not a DOM implementation.
// ./index.ts imports this first.

const global = globalThis as unknown as Record<string, unknown>;

// THREE.AudioListener and THREE.Audio make their AudioContext with `new window.AudioContext()`;
// the rest of three only checks `typeof window` to note its version in `window.__THREE__`
global.window ??= globalThis;
