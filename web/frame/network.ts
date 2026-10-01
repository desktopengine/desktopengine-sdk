// DesktopEngine SDK
// Copyright © 2026 DesktopEngine. All rights reserved.
//
// This source code is licensed under the Apache Licence 2.0.

// The network on the web, with the engine's rules: http(s) and ws(s) need the network permission and a host in
// network.domains (no IP addresses or local names), and go through the host's preview proxy, which browsers need
// anyway (CORS) and which only forwards GET requests and WebSockets. Paths and defile:// URLs read the package's and
// the content's own files, as in the app. Images, videos and audio load remote files through the same rules.

import { fileBytes, fileURL, mimeType } from './files.ts';
import { hasPermission, state } from './state.ts';

function normalizedHost(host: string): string {
  let normalized = host.toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1);
  return normalized.replace(/\.+$/, '');
}

function isAddressOrLocalName(host: string): boolean {
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.includes(':')) return true;
  const last = host.split('.').pop() ?? '';
  return /^[0-9][0-9a-fx]*$/.test(last);
}

function matches(host: string, pattern: string): boolean {
  const normalized = normalizedHost(pattern);
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1);
    return host.length > suffix.length && host.endsWith(suffix);
  }
  return host === normalized;
}

/** Why a remote URL can't be reached, as the engine says it; null when it can */
export function networkDenial(url: URL): string | null {
  if (!hasPermission('network')) return 'network access needs the "network" permission in manifest.json';
  const host = normalizedHost(url.hostname);
  if (isAddressOrLocalName(host)) return `"${host}" is an IP address or a local name, which content can't reach`;
  if (!(state.launch?.networkDomains ?? []).some((pattern) => matches(host, pattern))) {
    return `"${host}" isn't one of the domains in network.domains of manifest.json`;
  }
  if (!state.launch?.proxy) return 'the web preview has no network';
  return null;
}

const isRemote = (url: string): boolean => /^(https?|wss?):/i.test(url);
const isLocal = (url: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(url) || /^defile:/i.test(url);

function proxied(url: string): string {
  const proxy = state.launch!.proxy!;
  const separator = proxy.includes('?') ? '&' : '?';
  return `${proxy}${separator}url=${encodeURIComponent(url)}`;
}

/** What an Image, Video, CanvasImage or Audio loads for a src: a blob: URL for a file, the proxy for a remote one */
export function mediaURL(src: string): string | null {
  if (!src) return null;
  if (/^(data|blob):/i.test(src)) return src;
  if (isLocal(src)) return fileURL(src);
  if (/^https?:/i.test(src)) {
    try {
      return networkDenial(new URL(src)) ? null : proxied(src);
    } catch {
      return null;
    }
  }
  return null;
}

/** Replaces fetch, XMLHttpRequest and WebSocket in the frame's realm */
export function installNetwork(scope: typeof globalThis): void {
  const nativeFetch = scope.fetch.bind(scope);

  scope.fetch = async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (isLocal(url)) {
      const bytes = fileBytes(url);
      if (!bytes) return new Response(null, { status: 404, statusText: 'Not Found' });
      return new Response(bytes.slice() as BodyInit, { status: 200, headers: { 'Content-Type': mimeType(url) } });
    }
    if (!isRemote(url)) return nativeFetch(input, init);
    const target = new URL(url);
    const denial = networkDenial(target);
    if (denial) throw new TypeError(`Failed to fetch ${url}: ${denial}`);
    if (method !== 'GET' && method !== 'HEAD') {
      throw new TypeError(`Failed to fetch ${url}: the web preview only sends GET requests, the app sends ${method} too`);
    }
    const response = await nativeFetch(proxied(target.href), {
      method,
      headers: init?.headers ?? request?.headers,
      signal: init?.signal ?? request?.signal,
      credentials: 'omit',
      cache: init?.cache,
    });
    Object.defineProperty(response, 'url', { value: target.href });
    return response;
  } as typeof fetch;

  const NativeXHR = scope.XMLHttpRequest;
  class XMLHttpRequest extends NativeXHR {
    private denial: string | null = null;

    override open(method: string, url: string | URL, async = true, username?: string | null, password?: string | null): void {
      const href = String(url);
      this.denial = null;
      let target = href;
      if (isLocal(href)) {
        target = fileURL(href) ?? 'data:,';
      } else if (/^https?:/i.test(href)) {
        const denial = networkDenial(new URL(href));
        const upper = method.toUpperCase();
        if (denial) this.denial = denial;
        else if (upper !== 'GET' && upper !== 'HEAD') this.denial = `the web preview only sends GET requests, the app sends ${upper} too`;
        target = this.denial ? 'data:,' : proxied(new URL(href).href);
      }
      super.open(method, target, async, username, password);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (this.denial) {
        console.error(`XMLHttpRequest: ${this.denial}`);
        setTimeout(() => {
          this.dispatchEvent(new ProgressEvent('error'));
          this.dispatchEvent(new ProgressEvent('loadend'));
        });
        return;
      }
      super.send(body);
    }
  }
  scope.XMLHttpRequest = XMLHttpRequest;

  const NativeWebSocket = scope.WebSocket;
  class ClosedSocket extends EventTarget {
    readonly readyState = 3;
    readonly bufferedAmount = 0;
    readonly extensions = '';
    readonly protocol = '';
    binaryType: BinaryType = 'blob';
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(readonly url: string, denial: string) {
      super();
      console.error(`WebSocket ${url}: ${denial}`);
      setTimeout(() => {
        const error = new Event('error');
        this.onerror?.(error);
        this.dispatchEvent(error);
        const close = new CloseEvent('close', { code: 1006, reason: denial, wasClean: false });
        this.onclose?.(close);
        this.dispatchEvent(close);
      });
    }

    send(): void {
      throw new DOMException('WebSocket is already in CLOSING or CLOSED state.', 'InvalidStateError');
    }

    close(): void {}
  }
  const WebSocketShim = function WebSocket(url: string | URL, protocols?: string | string[]) {
    const href = new URL(String(url)).href;
    const denial = networkDenial(new URL(href.replace(/^ws/i, 'http')));
    if (denial) return new ClosedSocket(href, denial);
    const proxy = new URL(state.launch!.proxy!);
    proxy.protocol = proxy.protocol === 'https:' ? 'wss:' : 'ws:';
    proxy.searchParams.set('url', href);
    const socket = new NativeWebSocket(proxy.href, protocols);
    Object.defineProperty(socket, 'url', { value: href });
    return socket;
  } as unknown as typeof WebSocket;
  Object.assign(WebSocketShim, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  WebSocketShim.prototype = NativeWebSocket.prototype;
  scope.WebSocket = WebSocketShim;
}
