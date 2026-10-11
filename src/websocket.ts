// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// RFC 6455, enough for `desktopengine dev` and the web preview's proxy: text and binary messages, fragments, ping and
// close, without extensions. The server side for the app (it connects with URLSessionWebSocketTask) and the browser;
// the client side for the proxy's connection to the content's server. Node.js has no WebSocket server of its own, and
// its client can't be made to connect only to an address that was checked.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

/** `Sec-WebSocket-Accept` for a `Sec-WebSocket-Key`. */
export function acceptKey(key: string): string {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

/**
 * Completes the handshake of an HTTP `upgrade` request, with the subprotocol given (one the client offered).
 * @returns `null` when the request isn't a WebSocket handshake
 */
export function acceptUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, protocol?: string): WebSocketConnection | null {
  const key = request.headers['sec-websocket-key'];
  const upgrade = String(request.headers.upgrade ?? '').toLowerCase();
  if (upgrade !== 'websocket' || typeof key !== 'string' || key.length === 0) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []),
    '',
    '',
  ].join('\r\n'));
  return new WebSocketConnection(socket, head);
}

export interface WebSocketConnectionEvents {
  /** text messages are strings, binary ones Buffers */
  message: [data: string | Buffer];
  /** 1006 when the connection ended without a close frame */
  close: [code: number, reason: string];
}

export interface WebSocketConnectionOptions {
  /** The client's side of the connection: what it sends is masked, what it receives isn't */
  client?: boolean;
}

export class WebSocketConnection extends EventEmitter<WebSocketConnectionEvents> {
  private readonly socket: Duplex;
  private readonly client: boolean;
  private buffer: Buffer;
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private closed = false;

  constructor(socket: Duplex, head?: Buffer, { client = false }: WebSocketConnectionOptions = {}) {
    super();
    this.socket = socket;
    this.client = client;
    this.buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

    const tcp = socket as Duplex & { setNoDelay?: (noDelay: boolean) => void };
    tcp.setNoDelay?.(true);
    socket.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.parse();
    });
    socket.on('close', () => this.finish(1006, ''));
    socket.on('error', () => this.finish(1006, ''));
    if (this.buffer.length > 0) setImmediate(() => this.parse());
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Sends a text message, or a binary one for a Buffer; other objects are sent as JSON. */
  send(message: string | Buffer | object): void {
    if (Buffer.isBuffer(message)) {
      this.writeFrame(OPCODE.binary, message);
      return;
    }
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    this.writeFrame(OPCODE.text, Buffer.from(text, 'utf8'));
  }

  /**
   * 1005 sends a close frame without a code (the other side reads 1005); another code that can't be sent (1006, 1015,
   * out of range) is sent as 1000. For a connection that ended abnormally, destroy() instead
   */
  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    let body = Buffer.alloc(0);
    if (code !== 1005) {
      const sent = (code >= 1000 && code < 1005) || (code > 1006 && code < 1015) || (code >= 3000 && code < 5000) ? code : 1000;
      // at most 123 bytes, not cut inside a character
      let reasonData = Buffer.from(reason, 'utf8');
      while (reasonData.length > 123) reasonData = Buffer.from(reasonData.subarray(0, 123).toString('utf8').replace(/.$/su, ''), 'utf8');
      body = Buffer.alloc(2 + reasonData.length);
      body.writeUInt16BE(sent, 0);
      reasonData.copy(body, 2);
    }
    this.writeFrame(OPCODE.close, body);
    this.socket.end();
    this.finish(code, reason);
  }

  /** Ends the connection without a close frame: the other side reads 1006, an abnormal closure */
  destroy(): void {
    this.socket.destroy();
    this.finish(1006, '');
  }

  private finish(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, reason);
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (this.closed || this.socket.destroyed) return;
    const maskBit = this.client ? 0x80 : 0;
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, maskBit | payload.length]);
    } else if (payload.length < 0x10000) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = maskBit | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = maskBit | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    if (!this.client) {
      this.socket.write(Buffer.concat([header, payload]));
      return;
    }
    // clients mask what they send
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) {
      masked[i] ^= mask[i & 3];
    }
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  private parse(): void {
    while (!this.closed && this.buffer.length >= 2) {
      const buffer = this.buffer;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_SIZE)) {
          this.close(1009, 'message too big');
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (length > MAX_MESSAGE_SIZE) {
        this.close(1009, 'message too big');
        return;
      }
      // clients must mask what they send, servers mustn't
      if (masked === this.client) {
        this.close(1002, masked ? 'masked frame' : 'unmasked frame');
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;

      const mask = buffer.subarray(offset, offset + maskLength);
      offset += maskLength;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (masked) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i & 3];
        }
      }
      this.buffer = buffer.subarray(offset + length);
      this.handleFrame(fin, opcode, payload);
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OPCODE.continuation: {
        if (!this.fragmentOpcode) {
          this.close(1002, 'unexpected continuation');
          return;
        }
        this.fragments.push(payload);
        const size = this.fragments.reduce((sum, fragment) => sum + fragment.length, 0);
        if (size > MAX_MESSAGE_SIZE) {
          this.close(1009, 'message too big');
          return;
        }
        if (fin) {
          const data = Buffer.concat(this.fragments);
          const messageOpcode = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = 0;
          this.emitMessage(messageOpcode, data);
        }
        return;
      }
      case OPCODE.text:
      case OPCODE.binary:
        if (fin) {
          this.emitMessage(opcode, payload);
        } else {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
        }
        return;
      case OPCODE.close:
        // a close frame without a code is 1005, as a browser reads it
        this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1005, payload.subarray(2).toString('utf8'));
        return;
      case OPCODE.ping:
        this.writeFrame(OPCODE.pong, payload);
        return;
      case OPCODE.pong:
        return;
      default:
        this.close(1002, 'unknown opcode');
    }
  }

  private emitMessage(opcode: number, data: Buffer): void {
    this.emit('message', opcode === OPCODE.text ? data.toString('utf8') : data);
  }
}
