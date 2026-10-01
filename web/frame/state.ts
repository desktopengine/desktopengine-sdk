// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// What the frame's parts share: the launch, what was granted, and the way to the host.

import type { FrameMessage, LaunchMessage, WebScreen } from '../protocol.ts';

export const state = {
  launch: null as LaunchMessage | null,
  screens: [] as WebScreen[],
  appearance: 'dark' as 'light' | 'dark',
  suspended: false,
  renderingPaused: false,
  muted: true,
  /** The host's limit and the content's (DesktopEngine.preferredFramesPerSecond); the lower one wins */
  hostMaxFramesPerSecond: 0,
  contentFramesPerSecond: 0,
};

export function send(message: FrameMessage, transfer: Transferable[] = []): void {
  parent.postMessage(message, '*', transfer);
}

export function hasPermission(permission: string): boolean {
  return state.launch?.permissions.includes(permission) ?? false;
}

/** Errors in the content's callbacks go to the host, as uncaught exceptions do in the app */
/** The content's own frames (its code runs as desktopengine:///<name>/index.js), without the runtime's or the message */
function contentStack(stack: string | undefined): string | undefined {
  const lines = (stack ?? '').split('\n').filter((line) => line.includes('desktopengine:///'));
  return lines.length ? lines.map((line) => line.trim()).join('\n') : undefined;
}

export function report(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  send({ type: 'exception', message, stack: error instanceof Error ? contentStack(error.stack) : undefined });
}

export function guard<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch (error) {
    report(error);
    return undefined;
  }
}

let identifiers = 0;
/** Like the engine's pointer strings */
export function nextIdentifier(): string {
  identifiers += 1;
  return `0x${(0x600000000000 + identifiers * 0x40).toString(16)}`;
}
