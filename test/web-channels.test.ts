// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// BroadcastChannel in the web runtime (web/frame/channels.ts) keeps to the engine's rules: its scopes are the
// declared ones, it throws where the app throws, and a message reaches every open channel of its name but the sender.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SCOPES, createChannels } from '../web/frame/channels.ts';
import type { FrameMessage } from '../web/protocol.ts';

const declarations = fs.readFileSync(path.join(import.meta.dirname, '..', 'types', 'desktop-engine.d.ts'), 'utf8');

type Channel = EventTarget & { scope: string; onmessage: unknown; postMessage(message: unknown): void; close(): void };

/** A frame's channels, with what they send the host */
function frame(namespaceChannels: boolean) {
  const sent: FrameMessage[] = [];
  const { BroadcastChannel, receive } = createChannels({ send: (message) => sent.push(message), namespaceChannels: () => namespaceChannels });
  const open = (name: string, options?: { scope?: string }) => new BroadcastChannel(name, options) as Channel;
  return { sent, open, receive };
}

const errorName = (action: () => unknown): string | undefined => {
  try {
    action();
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
};

test('BroadcastChannel on the web has the declared scopes', () => {
  const union = /\ntype BroadcastChannelScope =([^;]*);/.exec(declarations)?.[1] ?? '';
  assert.deepEqual([...SCOPES].sort(), [...union.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort());
});

test('BroadcastChannel on the web throws where the app throws', () => {
  const imported = frame(false);
  assert.equal(errorName(() => imported.open('x', { scope: 'world' })), 'TypeError');
  assert.equal(errorName(() => imported.open('x', { scope: 'global' })), 'TypeError');
  assert.equal(errorName(() => imported.open('x', { scope: 'namespace' })), 'SecurityError');

  const { open } = frame(true);
  const channel = open('limits', { scope: 'namespace' });
  assert.equal(channel.scope, 'namespace');
  assert.equal(Object.prototype.toString.call(channel), '[object BroadcastChannel]');
  assert.equal(errorName(() => channel.postMessage(() => 1)), 'DataCloneError');
  assert.equal(errorName(() => channel.postMessage('x'.repeat(600 * 1024))), 'DataCloneError');
  let posted = 0;
  const error = errorName(() => {
    for (; posted < 300; posted++) channel.postMessage(posted);
  });
  assert.equal(error, 'QuotaExceededError');
  assert.ok(posted >= 239 && posted <= 241, `${posted} messages before the limit`);
  channel.close();
  assert.equal(errorName(() => channel.postMessage(1)), 'InvalidStateError');
});

test('a message on the web reaches every open channel of its name but the one that posted it', () => {
  const { sent, open, receive } = frame(true);
  const first = open('scene');
  const second = open('scene');
  const closed = open('scene');
  const other = open('scene', { scope: 'namespace' });
  // the host is told once a name is open in a scope, and once it no longer is
  const told = () => sent.flatMap((message) => (message.type === 'channel' ? [`${message.scope} ${message.name} ${message.open}`] : []));
  assert.deepEqual(told(), ['package scene true', 'namespace scene true']);
  closed.close();

  const got: string[] = [];
  for (const [label, channel] of [['first', first], ['second', second], ['closed', closed], ['other', other]] as const) {
    channel.onmessage = (event: MessageEvent) => got.push(`${label} ${JSON.stringify(event.data)}`);
  }
  first.postMessage({ n: 1 });
  const posted = sent.at(-1);
  assert.ok(posted?.type === 'broadcast');
  // the host sends it back to the sender's frame with the sender's id, to other frames with -1
  receive({ ...posted, type: 'broadcast' });
  receive({ type: 'broadcast', scope: 'package', name: 'scene', data: { n: 2 }, source: -1, newest: -1 });
  assert.deepEqual(got, ['second {"n":1}', 'first {"n":2}', 'second {"n":2}']);

  // a channel made after the content posted doesn't get its message, as in browsers; another content's it does
  got.length = 0;
  first.postMessage({ n: 3 });
  const late = sent.at(-1);
  const third = open('scene');
  third.onmessage = (event: MessageEvent) => got.push(`third ${JSON.stringify(event.data)}`);
  assert.ok(late?.type === 'broadcast');
  receive({ ...late, type: 'broadcast' });
  receive({ type: 'broadcast', scope: 'package', name: 'scene', data: { n: 4 }, source: -1, newest: -1 });
  assert.deepEqual(got, ['second {"n":3}', 'first {"n":4}', 'second {"n":4}', 'third {"n":4}']);
  third.close();

  // each channel gets its own copy, made before any listener runs
  got.length = 0;
  first.onmessage = (event: MessageEvent) => {
    (event.data as { n: number }).n = 99;
  };
  receive({ type: 'broadcast', scope: 'package', name: 'scene', data: { n: 5 }, source: -1, newest: -1 });
  assert.deepEqual(got, ['second {"n":5}']);
  for (const channel of [first, second, other]) channel.close();
  assert.deepEqual(told().slice(2), ['package scene false', 'namespace scene false']);
});
