// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// BroadcastChannel in the web runtime (web/frame/channels.ts) keeps to the engine's rules: its scopes are the
// declared ones, it throws where the app throws, a message reaches every open channel of its name but the sender, and
// a message is encoded, measured and copied as the app does it (web/frame/messages.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';

import { SCOPES, createChannels } from '../web/frame/channels.ts';
import { decodeMessage, encodeMessage, messageSize, parseMessage } from '../web/frame/messages.ts';
import { standIn } from '../web/frame/stand-ins.ts';
import type { FrameMessage, HostMessage } from '../web/protocol.ts';

const declarations = fs.readFileSync(path.join(import.meta.dirname, '..', 'types', 'desktop-engine.d.ts'), 'utf8');

type Channel = EventTarget & { scope: string; onmessage: unknown; onmessageerror: unknown; postMessage(message: unknown): void; close(): void };
type Broadcast = Extract<HostMessage, { type: 'broadcast' }>;

/** One of the runtime's stand-ins for the engine's own objects: its fields would otherwise go as data */
class StandIn {
  listeners = new Map();
}
const isEngineObject = (value: object) => value instanceof StandIn;

/** A frame's channels, with what they send the host */
function frame(namespaceChannels: boolean) {
  const sent: FrameMessage[] = [];
  const { BroadcastChannel, receive } = createChannels({ send: (message) => sent.push(message), namespaceChannels: () => namespaceChannels, isEngineObject });
  const open = (name: string, options?: { scope?: string }) => new BroadcastChannel(name, options) as Channel;
  /** The last message the frame posted, as the host gives it back to the frame (the browser copies it on the way) */
  const lastPosted = (): Broadcast => {
    const posted = sent.filter((message) => message.type === 'broadcast').at(-1);
    assert.ok(posted?.type === 'broadcast');
    return structuredClone(posted) as Broadcast;
  };
  /** What the channels of the scope and name told the host */
  const told = () => sent.flatMap((message) => (message.type === 'channel' ? [`${message.scope} ${message.name} ${message.open}`] : []));
  return { open, receive, lastPosted, told };
}

/** Another content's message, as the host passes it on */
const fromOther = (data: unknown, name = 'scene'): Broadcast => ({ type: 'broadcast', scope: 'package', name, data: encodeMessage(data), source: -1, newest: -1 });

const errorName = (action: () => unknown): string | undefined => {
  try {
    action();
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
};

/** What another channel of the content gets when one posts `value` */
function copied(value: unknown): unknown {
  const { open, receive, lastPosted } = frame(true);
  const sender = open('copy');
  const receiver = open('copy');
  let got: unknown = 'nothing';
  receiver.onmessage = (event: MessageEvent) => {
    got = event.data;
  };
  sender.postMessage(value);
  receive(lastPosted());
  return got;
}

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
  const start = performance.now();
  const error = errorName(() => {
    for (; posted < 300; posted++) channel.postMessage(posted);
  });
  // the allowance refills while the loop runs, 240 a second: a busy machine (a GC pause, other tests) gets a few more
  const refilled = Math.ceil(((performance.now() - start) / 1000) * 240);
  assert.equal(error, 'QuotaExceededError');
  assert.ok(posted >= 239 && posted <= 241 + refilled, `${posted} messages before the limit`);
  channel.close();
  assert.equal(errorName(() => channel.postMessage(1)), 'InvalidStateError');
});

test('a message on the web reaches every open channel of its name but the one that posted it', () => {
  const { open, receive, lastPosted, told } = frame(true);
  const first = open('scene');
  const second = open('scene');
  const closed = open('scene');
  const other = open('scene', { scope: 'namespace' });
  // the host is told once a name is open in a scope, and once it no longer is
  assert.deepEqual(told(), ['package scene true', 'namespace scene true']);
  closed.close();

  const got: string[] = [];
  for (const [label, channel] of [['first', first], ['second', second], ['closed', closed], ['other', other]] as const) {
    channel.onmessage = (event: MessageEvent) => got.push(`${label} ${JSON.stringify(event.data)}`);
  }
  first.postMessage({ n: 1 });
  // the host sends it back to the sender's frame with the sender's id, to other frames with -1
  receive(lastPosted());
  receive(fromOther({ n: 2 }));
  assert.deepEqual(got, ['second {"n":1}', 'first {"n":2}', 'second {"n":2}']);

  // a channel made after the content posted doesn't get its message, as in browsers; another content's it does
  got.length = 0;
  first.postMessage({ n: 3 });
  const late = lastPosted();
  const third = open('scene');
  third.onmessage = (event: MessageEvent) => got.push(`third ${JSON.stringify(event.data)}`);
  receive(late);
  receive(fromOther({ n: 4 }));
  assert.deepEqual(got, ['second {"n":3}', 'first {"n":4}', 'second {"n":4}', 'third {"n":4}']);
  third.close();

  // each channel gets its own copy: what a listener does to its copy, the next channel doesn't see
  got.length = 0;
  first.onmessage = (event: MessageEvent) => {
    (event.data as { n: number }).n = 99;
  };
  receive(fromOther({ n: 5 }));
  assert.deepEqual(got, ['second {"n":5}']);
  for (const channel of [first, second, other]) channel.close();
  assert.deepEqual(told().slice(2), ['package scene false', 'namespace scene false']);
});

test('a channel on the web that a listener before it gives a listener gets the same message, as in browsers', () => {
  for (const from of ['the same content', 'another content']) {
    const { open, receive, lastPosted } = frame(true);
    const sender = open('late');
    const first = open('late');
    const second = open('late');
    const got: string[] = [];
    first.onmessage = (event: MessageEvent) => {
      got.push(`first ${String(event.data)}`);
      second.onmessage = (later: MessageEvent) => got.push(`second ${String(later.data)}`);
    };
    if (from === 'the same content') {
      sender.postMessage('one');
      receive(lastPosted());
    } else {
      receive(fromOther('one', 'late'));
    }
    assert.deepEqual(got, ['first one', 'second one'], from);
    for (const channel of [sender, first, second]) channel.close();
  }
});

test('what the content puts on Array.prototype or Object.prototype doesn\'t change its messages on the web', () => {
  const values = (): unknown[] => [{ a: 1, b: 2 }, [10, 20], new Map<unknown, unknown>([[1, 'one'], ['k', [2]]]), new Set(['x', 3]), [[1, [2, [3]]], { list: [4, { deep: [5] }] }]];
  const prototypes = Array.prototype as unknown as Record<string, unknown>;
  const objects = Object.prototype as unknown as Record<string, unknown>;
  // each puts something on a prototype and gives back what takes it away
  const pollutions: Record<string, () => () => void> = {
    'an index accessor on Array.prototype': () => {
      Object.defineProperty(Array.prototype, '0', { set() {}, get() { return 'polluted'; }, configurable: true });
      return () => delete prototypes['0'];
    },
    'Array.prototype.toJSON': () => {
      prototypes.toJSON = () => 'polluted';
      return () => delete prototypes.toJSON;
    },
    'Object.prototype.toJSON': () => {
      objects.toJSON = () => 'polluted';
      return () => delete objects.toJSON;
    },
  };
  for (const [label, pollute] of Object.entries(pollutions)) {
    // the frame's own lists are kept in Maps: a pushed array would lose its items to the accessor
    const posted = new Map<number, FrameMessage>();
    const { BroadcastChannel, receive } = createChannels({ send: (message) => posted.set(posted.size, message), namespaceChannels: () => true });
    const sender = new BroadcastChannel('polluted') as Channel;
    const receiver = new BroadcastChannel('polluted') as Channel;
    const got = new Map<number, unknown>();
    let errors = 0;
    receiver.onmessage = (event: MessageEvent) => got.set(got.size, event.data);
    receiver.onmessageerror = () => errors++;
    const clean = values().map((value) => encodeMessage(value).tree);
    const restore = pollute();
    let trees: string[];
    try {
      trees = values().map((value) => encodeMessage(value).tree);
      for (const value of values()) sender.postMessage(value);
    } finally {
      restore();
    }
    assert.deepEqual(trees, clean, label);
    for (const message of posted.values()) {
      if (message.type === 'broadcast') receive(structuredClone(message) as Broadcast);
    }
    assert.equal(errors, 0, label);
    assert.deepEqual([...got.values()], values().map((value) => structuredClone(value)), label);
  }

  // and the receiving content's accessor doesn't lose an object a message refers to again
  const { open, receive } = frame(true);
  const channel = open('cyclic');
  let got: unknown;
  channel.onmessage = (event: MessageEvent) => {
    got = event.data;
  };
  const cyclic: Record<string, unknown> = { list: [1, 2] };
  cyclic.self = cyclic;
  cyclic.again = cyclic.list;
  const message = fromOther(cyclic, 'cyclic');
  const restore = pollutions['an index accessor on Array.prototype']();
  try {
    receive(message);
  } finally {
    restore();
  }
  const copy = got as Record<string, unknown>;
  assert.equal(copy.self, copy);
  assert.equal(copy.again, copy.list);
  assert.deepEqual(copy.list, [1, 2]);
});

test('a message on the web is encoded and counted as the app does it', () => {
  // 2 bytes for each character of the encoded tree (numbers, keys, array indexes and escapes too), and the bytes alongside
  const size = (value: unknown) => {
    const message = encodeMessage(value);
    return { tree: message.tree, size: messageSize(message) };
  };
  assert.deepEqual(size([1.5, 2]), { tree: '["a",2,"0",1.5,"1",2]', size: 42 });
  assert.deepEqual(size({ text: 'a\n"\u0001\ud800' }), { tree: String.raw`["o","text","a\n\"\u0001\ud800"]`, size: 64 });
  assert.deepEqual(size({ x: NaN, y: -0, z: undefined, n: 10n, i: Infinity }), {
    tree: '["o","x",["n","NaN"],"y",["n","-0"],"z",["u"],"n",["i","10"],"i",["n","Infinity"]]',
    size: 164,
  });
  // a buffer goes once, however many views of it there are
  const buffer = new ArrayBuffer(16);
  assert.deepEqual(size({ a: new Uint8Array(buffer, 4, 8), b: new Float32Array(buffer) }), {
    tree: '["o","a",["v","Uint8Array",["ab",0],4,8],"b",["v","Float32Array",["r",2],0,4]]',
    size: 172,
  });
  const shared = { k: 1 };
  const cyclic: Record<string, unknown> = { one: shared, two: shared, list: [shared] };
  cyclic.self = cyclic;
  assert.deepEqual(size(cyclic), { tree: '["o","one",["o","k",1],"two",["r",1],"list",["a",1,"0",["r",1]],"self",["r",0]]', size: 158 });
  assert.deepEqual(size([Object(1), Object('s'), Object(false), new Date(5), /x/g]), {
    tree: '["a",5,"0",["N",1],"1",["S","s"],"2",["B",false],"3",["D",5],"4",["R","x","g"]]',
    size: 158,
  });
  assert.equal(size(new Blob(['hello'], { type: 'text/plain' })).size, '["b",0,"text/plain"]'.length * 2 + 5);

  // 30,000 numbers take 1.4 MB in the app: too big
  const numbers = Array.from({ length: 30000 }, (_, index) => index / 7);
  assert.equal(size(numbers).size, 1453494);
  const { open } = frame(true);
  const channel = open('sizes');
  assert.equal(errorName(() => channel.postMessage(numbers)), 'DataCloneError');
  // 6,000 numbers take 278 KB: the 16 MB a second run out long before 240 messages
  const fewer = numbers.slice(0, 6000);
  assert.equal(size(fewer).size, 278040);
  let posted = 0;
  const error = errorName(() => {
    for (; posted < 240; posted++) channel.postMessage(fewer);
  });
  assert.equal(error, 'QuotaExceededError');
  assert.ok(posted >= 60 && posted < 120, `${posted} messages before the limit`);
});

test('the web copies what the app copies, as the app copies it', async () => {
  class Point {
    x = 1;
    y = 2;
    get sum(): number {
      return this.x + this.y;
    }
  }
  const point = copied(new Point()) as object;
  assert.deepEqual(point, { x: 1, y: 2 });
  assert.equal(Object.getPrototypeOf(point), Object.prototype);
  // a Proxy is the object it stands for (the browser's structuredClone refuses it)
  assert.deepEqual(copied(new Proxy({ a: 1, list: new Proxy([2, 3], {}) }, {})), { a: 1, list: [2, 3] });
  const sparse = copied(Object.assign([1, , 3], { extra: 'x' })) as unknown[];
  assert.equal(sparse.length, 3);
  assert.ok(!(1 in sparse));
  assert.equal((sparse as unknown as { extra: string }).extra, 'x');
  const keyed = copied(JSON.parse('{"__proto__": {"x": 1}}')) as object;
  assert.equal(Object.getPrototypeOf(keyed), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(keyed, '__proto__')?.value, { x: 1 });
  const cyclic = copied((() => {
    const value: Record<string, unknown> = { shared: { k: 1 } };
    value.again = value.shared;
    value.self = value;
    return value;
  })()) as Record<string, unknown>;
  assert.equal(cyclic.self, cyclic);
  assert.equal(cyclic.again, cyclic.shared);
  assert.deepEqual(copied(new Map<unknown, unknown>([[1, new Set(['a'])]])), new Map([[1, new Set(['a'])]]));
  assert.deepEqual(copied([10n, undefined, NaN, -0, Object(2), new Date(3), /a/g]), [10n, undefined, NaN, -0, Object(2), new Date(3), /a/g]);
  const error = copied(Object.assign(new RangeError('out'), { stack: 'stack' })) as Error;
  assert.ok(error instanceof RangeError);
  assert.equal(error.message, 'out');
  assert.equal(error.stack, 'stack');
  const exception = copied(new DOMException('gone', 'NotFoundError')) as DOMException;
  assert.ok(exception instanceof DOMException);
  assert.equal(exception.name, 'NotFoundError');
  const buffer = new ArrayBuffer(8);
  const views = copied({ bytes: new Uint8Array(buffer, 2, 4), floats: new Float32Array(buffer) }) as { bytes: Uint8Array; floats: Float32Array };
  assert.equal(views.bytes.buffer, views.floats.buffer);
  assert.deepEqual([views.bytes.byteOffset, views.bytes.length, views.floats.length], [2, 4, 2]);
  const files = copied({ blob: new Blob(['hi'], { type: 'text/plain' }), file: new File(['yo'], 'a.txt', { type: 'text/plain', lastModified: 5 }) }) as { blob: Blob; file: File };
  assert.ok(files.file instanceof File);
  assert.deepEqual([await files.blob.text(), files.blob.type, await files.file.text(), files.file.name, files.file.lastModified], ['hi', 'text/plain', 'yo', 'a.txt', 5]);
});

test('the web refuses what the app refuses', () => {
  const refused = (value: unknown) => errorName(() => encodeMessage(value, isEngineObject));
  // the runtime's gradients are known as stand-ins for the engine's native ones, not by their tag (see below)
  const gradient = standIn(Object.create(Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'CanvasGradient' } })) as object);
  for (const [label, value] of Object.entries({
    function: () => 1, symbol: Symbol('s'), promise: Promise.resolve(), 'weak map': new WeakMap(), 'weak set': new WeakSet(),
    'weak ref': new WeakRef({}), 'event target': new EventTarget(), event: new Event('x'), url: new URL('https://example.com'),
    headers: new Headers(), 'abort controller': new AbortController(), crypto: globalThis.crypto, global: globalThis,
    'shared memory': new Uint8Array(new SharedArrayBuffer(4)), 'runtime object': new StandIn(), gradient,
    'deep inside': { list: [1, { callback: () => 2 }] },
  })) {
    assert.equal(refused(value), 'DataCloneError', label);
  }
  // a channel refuses the runtime's stand-ins as the app refuses the engine's objects
  assert.equal(errorName(() => frame(true).open('x').postMessage({ system: new StandIn() })), 'DataCloneError');
  // what is only tagged as one, or made from one, is an object of the content's, as in the app
  class Tagged {
    stop = 1;
    get [Symbol.toStringTag]() {
      return 'CanvasGradient';
    }
  }
  for (const value of [new Tagged(), Object.create(gradient)]) assert.equal(refused(value), undefined);
  // the engine's bitmaps can't be sent; the browser would copy its own
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.ImageBitmap = class ImageBitmap {};
  try {
    assert.equal(refused({ bitmap: new (scope.ImageBitmap as new () => object)() }), 'DataCloneError');
  } finally {
    delete scope.ImageBitmap;
  }
});

test('a message on the web that isn\'t one makes a messageerror', () => {
  const { open, receive } = frame(true);
  const channel = open('scene');
  const got: string[] = [];
  channel.onmessage = (event: MessageEvent) => got.push(`message ${JSON.stringify(event.data)}`);
  channel.onmessageerror = (event: MessageEvent) => got.push(`${event.type} ${String(event.data)}`);
  const other = (data: unknown): Broadcast => ({ type: 'broadcast', scope: 'package', name: 'scene', data, source: -1, newest: -1 });
  receive(other('text'));
  receive(other({ tree: '["r",0]', buffers: [] }));
  receive(other({ tree: '["o","a",["ab",0],"b",["ab",0]]', buffers: [new ArrayBuffer(1)] }));
  receive(other({ tree: '["v","Uint8Array",["o"],0,0]', buffers: [] }));
  receive(other({ tree: '[', buffers: [] }));
  receive(other(encodeMessage({ fine: true })));
  // the event's data is the engine's MessageEvent's: what the init has, undefined (the browser's would be null)
  assert.deepEqual(got, [...Array(5).fill('messageerror undefined'), 'message {"fine":true}']);
  // the copies of what decodes share nothing with what came
  const message = encodeMessage({ bytes: new Uint8Array([1, 2]) });
  const { tree, buffers } = parseMessage(message);
  const copy = decodeMessage(tree, buffers, true) as { bytes: Uint8Array };
  assert.notEqual(copy.bytes.buffer, message.buffers[0]);
  assert.deepEqual([...copy.bytes], [1, 2]);
});

test('listeners for messages on the web are called as EventTarget calls them', () => {
  const { open, receive } = frame(true);
  const channel = open('scene');
  const got: string[] = [];
  const twice = (event: Event) => got.push(`twice ${(event as MessageEvent).data}`);
  channel.addEventListener('message', twice);
  channel.addEventListener('message', twice);
  channel.addEventListener('message', (event) => got.push(`once ${(event as MessageEvent).data}`), { once: true });
  const object = { handleEvent(this: unknown, event: Event) {
    got.push(`object ${(event as MessageEvent).data} ${this === object}`);
  } };
  channel.addEventListener('message', object);
  const controller = new AbortController();
  channel.addEventListener('message', () => got.push('aborted'), { signal: controller.signal });
  controller.abort();
  channel.addEventListener('message', function (this: unknown) {
    got.push(`this ${this === channel}`);
  });
  receive(fromOther(1));
  receive(fromOther(2));
  channel.removeEventListener('message', object);
  channel.removeEventListener('message', twice);
  receive(fromOther(3));
  assert.deepEqual(got, ['twice 1', 'once 1', 'object 1 true', 'this true', 'twice 2', 'object 2 true', 'this true', 'this true']);
});

/** Node's garbage collector, to see what the runtime lets go */
function collector(): () => Promise<void> {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  return async () => {
    for (let round = 0; round < 3; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

test('a channel on the web without listeners is let go once the content no longer has it, as in browsers', async () => {
  const collect = collector();
  const { open, receive, told } = frame(true);
  // posted and forgotten, never closed
  const postAndForget = () => {
    for (let index = 0; index < 50; index++) open('forgotten').postMessage(index);
  };
  postAndForget();
  // kept: it has a listener, which may still be called
  const got: unknown[] = [];
  (() => {
    open('kept').onmessage = (event: MessageEvent) => got.push(event.data);
  })();
  // let go: its listener was removed
  (() => {
    const channel = open('removed');
    const listener = () => got.push('removed');
    channel.addEventListener('message', listener);
    channel.removeEventListener('message', listener);
  })();
  const released = () => told().includes('package forgotten false') && told().includes('package removed false');
  for (let attempt = 0; attempt < 10 && !released(); attempt++) await collect();
  assert.ok(told().includes('package forgotten false'), told().join(', '));
  assert.ok(told().includes('package removed false'), told().join(', '));
  assert.ok(!told().includes('package kept false'));
  receive(fromOther('still here', 'kept'));
  assert.deepEqual(got, ['still here']);
});
