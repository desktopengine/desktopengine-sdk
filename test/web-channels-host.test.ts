// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The web desktop (web/host/desktop.ts) passes BroadcastChannel messages between its contents' frames as the app
// does: only to the contents that share the channel's scope with the sender (the same package, or the same namespace
// for those that may use it) and have a channel of its name open, the sender's id back only to the sender. The
// desktop's own code runs here without a DOM, its contents stand-ins whose frames are the web runtime's channels.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as esbuild from 'esbuild';

import { createChannels } from '../web/frame/channels.ts';
import type { FrameMessage, HostMessage } from '../web/protocol.ts';

interface Spec {
  name: string;
  code: string;
  manifest?: { id?: string };
  namespaceChannels?: boolean;
}

/** A content of the desktop, without its frame */
interface Content {
  spec: Spec;
  channels: Set<string>;
  channelGroup(scope: string): string | null;
  receive(message: unknown): void;
  post(message: HostMessage): void;
}

interface Host {
  WebContent: { prototype: object };
  WebDesktop: { prototype: object };
}

/** The desktop's code, bundled as the SDK bundles it (node can't run the TypeScript of its classes as it is) */
async function loadHost(): Promise<Host> {
  const result = await esbuild.build({
    entryPoints: [path.join(import.meta.dirname, '..', 'web', 'host', 'desktop.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    define: { __FRAME_RUNTIME__: '""' },
    logLevel: 'silent',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)) as Host;
}

const host = await loadHost();
let serials = 0;

/** A desktop of contents, each with the channels of a frame of its own */
function desktop() {
  const contents = new Set<Content>();
  const board = Object.assign(Object.create(host.WebDesktop.prototype) as object, { contents });
  const add = (id: string | undefined, options: { namespaceChannels?: boolean } = {}) => {
    const spec: Spec = { name: id ?? 'no id', code: '', manifest: id ? { id } : {}, ...options };
    const content = Object.assign(Object.create(host.WebContent.prototype) as Content, {
      desktop: board, spec, serial: ++serials, channels: new Set<string>(), broadcastAllowance: 300, broadcastTime: 0,
    });
    const got: string[] = [];
    /** What the desktop posted the content's frame */
    const posted: HostMessage[] = [];
    // the browser copies the messages between the page and the frames
    const frame = createChannels({
      send: (message) => content.receive(structuredClone(message)),
      namespaceChannels: () => content.channelGroup('namespace') !== null,
    });
    content.post = (message) => {
      posted.push(message);
      if (message.type === 'broadcast') frame.receive(structuredClone(message));
    };
    /** A channel of the content's frame that notes what it gets */
    const open = (name: string, scope: 'package' | 'namespace' = 'package') => {
      const channel = new frame.BroadcastChannel(name, { scope }) as EventTarget & { onmessage: unknown; postMessage(message: unknown): void };
      channel.onmessage = (event: MessageEvent) => got.push(`${spec.name} ${scope} ${name} ${JSON.stringify(event.data)}`);
      return channel;
    };
    /** What a frame that doesn't keep to the runtime's rules could send */
    const sendRaw = (message: FrameMessage) => content.receive(message);
    contents.add(content);
    return { content, got, posted, open, sendRaw };
  };
  return { add, contents };
}

test('the web desktop gives a content the scopes the app gives it', () => {
  const { add } = desktop();
  const scopes = (content: Content) => ['package', 'namespace', 'global'].map((scope) => content.channelGroup(scope));
  assert.deepEqual(scopes(add('app.desktopengine.acme.one').content), ['app.desktopengine.acme.one', 'acme', null]);
  // an imported package anyone could have made
  assert.deepEqual(scopes(add('app.desktopengine.acme.two', { namespaceChannels: false }).content), ['app.desktopengine.acme.two', null, null]);
  assert.deepEqual(scopes(add('com.example.thing').content), ['com.example.thing', null, null]);
  // without an id, its instance is a package of its own
  const lone = add(undefined).content;
  assert.match(String(lone.channelGroup('package')), /^instance:\d+$/);
  assert.notEqual(lone.channelGroup('package'), add(undefined).content.channelGroup('package'));
  assert.equal(lone.channelGroup('namespace'), null);
});

test('the web desktop keeps the channels of a frame to the scopes its content has', () => {
  const { add } = desktop();
  const { content, sendRaw } = add('app.desktopengine.acme.one', { namespaceChannels: false });
  sendRaw({ type: 'channel', scope: 'package', name: 'x', open: true });
  sendRaw({ type: 'channel', scope: 'namespace', name: 'x', open: true });
  sendRaw({ type: 'channel', scope: 'global' as 'package', name: 'x', open: true });
  assert.deepEqual([...content.channels], ['package\nx']);
  sendRaw({ type: 'channel', scope: 'package', name: 'x', open: false });
  assert.deepEqual([...content.channels], []);
});

test('a message on the web desktop reaches only the contents that share its scope with the sender', () => {
  const { add } = desktop();
  const one = add('app.desktopengine.acme.one');
  const oneAgain = add('app.desktopengine.acme.one');
  const two = add('app.desktopengine.acme.two');
  const imported = add('app.desktopengine.acme.three', { namespaceChannels: false });
  const stranger = add('app.desktopengine.evil.one');
  const lone = add(undefined);
  for (const { open } of [one, oneAgain, two, imported, stranger, lone]) open('state');
  for (const { open } of [one, oneAgain, two, stranger]) open('state', 'namespace');
  const own = one.open('state');
  const everything = () => [one, oneAgain, two, imported, stranger, lone].flatMap(({ got }) => got.splice(0));

  // the package: the same id; the sender's frame gets it back for its other channel only
  own.postMessage({ n: 1 });
  assert.deepEqual(everything(), ['app.desktopengine.acme.one package state {"n":1}', 'app.desktopengine.acme.one package state {"n":1}']);
  const backToSender = one.posted.filter((message) => message.type === 'broadcast').at(-1);
  const toOther = oneAgain.posted.filter((message) => message.type === 'broadcast').at(-1);
  assert.ok(backToSender?.type === 'broadcast' && toOther?.type === 'broadcast');
  assert.ok(backToSender.source > 0 && backToSender.newest >= backToSender.source);
  assert.deepEqual([toOther.source, toOther.newest], [-1, -1]);

  // the namespace: the same namespace, not a package that may not use it, not another namespace
  two.open('state', 'namespace').postMessage('hello');
  assert.deepEqual(everything(), [
    'app.desktopengine.acme.one namespace state "hello"',
    'app.desktopengine.acme.one namespace state "hello"',
    'app.desktopengine.acme.two namespace state "hello"',
  ]);
  stranger.open('state', 'namespace').postMessage('psst');
  assert.deepEqual(everything(), ['app.desktopengine.evil.one namespace state "psst"']);
  lone.open('state').postMessage('alone');
  assert.deepEqual(everything(), ['no id package state "alone"']);
});

test('a frame on the web desktop that doesn\'t keep to the rules reaches no one it may not reach', () => {
  const { add } = desktop();
  const one = add('app.desktopengine.acme.one');
  const imported = add('app.desktopengine.acme.three', { namespaceChannels: false });
  one.open('state', 'namespace');
  const data = { tree: '"sneaky"', buffers: [] };
  // a package that may not use the namespace scope claims a channel of it, and posts on it
  imported.sendRaw({ type: 'channel', scope: 'namespace', name: 'state', open: true });
  imported.sendRaw({ type: 'broadcast', scope: 'namespace', name: 'state', data, source: 1, newest: 1 });
  // nor does a scope the app doesn't have reach anyone
  imported.sendRaw({ type: 'broadcast', scope: 'global' as 'package', name: 'state', data, source: 1, newest: 1 });
  assert.deepEqual([...one.got, ...imported.got], []);
  // and the namespace's messages don't reach it
  one.open('state', 'namespace').postMessage('private');
  assert.deepEqual(imported.posted.filter((message) => message.type === 'broadcast'), []);
});

test('the web desktop drops the messages of a frame that posts faster than the app allows', () => {
  const { add } = desktop();
  const sender = add('app.desktopengine.acme.one');
  const receiver = add('app.desktopengine.acme.one');
  receiver.open('state');
  const data = { tree: '1', buffers: [] };
  for (let index = 0; index < 400; index++) sender.sendRaw({ type: 'broadcast', scope: 'package', name: 'state', data, source: 1, newest: 1 });
  const delivered = receiver.got.length;
  assert.ok(delivered >= 300 && delivered < 320, `${delivered} messages delivered`);
});
