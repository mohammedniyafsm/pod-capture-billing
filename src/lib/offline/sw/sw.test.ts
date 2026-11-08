// Service Worker fetch handling tests – focused on security guarantees
/// <reference lib="webworker" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleFetch } from '../../../../public/sw.js';

// Simple in-memory mock for the Cache API
let cacheStore: Map<string, unknown>;
const mockCache = {
  put: vi.fn((request: RequestInfo, response: Response) => {
    const key = typeof request === 'string' ? request : request.toString();
    cacheStore.set(key, response);
    return Promise.resolve();
  }),
};

function resetMocks() {
  cacheStore = new Map();
  vi.resetAllMocks();

  (global as Record<string, unknown>).caches = {
    match: vi.fn(() => Promise.resolve(undefined)),
    open: vi.fn(() => Promise.resolve(mockCache)),
    delete: vi.fn(() => Promise.resolve(true)),
    keys: vi.fn(() => Promise.resolve([])),
  };

  (global as Record<string, unknown>).fetch = vi.fn();
}

// Helper: creates a mock FetchEvent without triggering the handler
type MockRequest = { url: string; method?: string; mode?: RequestMode };
interface MockEvent {
  request: MockRequest;
  respondWith: (p: Promise<Response>) => void;
  responsePromise?: Promise<Response>;
}

function createEvent(
  url: string,
  opts: { method?: string; mode?: RequestMode } = {},
): MockEvent {
  const request: MockRequest = {
    url,
    method: opts.method ?? 'GET',
    mode: opts.mode ?? 'no-cors',
  };
  const event: MockEvent = {
    request,
    respondWith: vi.fn((p: Promise<Response>) => {
      event.responsePromise = p;
    }),
  };
  return event;
}

describe('Service Worker fetch handling', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('Navigation requests are network-only and never cached', async () => {
    // Set up mocks BEFORE invoking the handler
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('offline'),
    );

    ((global as Record<string, unknown>).caches as Record<string, ReturnType<typeof vi.fn>>).match.mockImplementation(
      (key: string) =>
        Promise.resolve(
          key === '/offline.html' ? new Response('offline') : undefined,
        ),
    );

    const event = createEvent('https://example.com/driver', {
      mode: 'navigate',
    });
    handleFetch(event as unknown as FetchEvent);

    const response = await event.responsePromise;
    expect(global.fetch).toHaveBeenCalledWith(event.request);
    expect(((global as Record<string, unknown>).caches as Record<string, unknown>).match).toHaveBeenCalledWith('/offline.html');
    expect(mockCache.put).not.toHaveBeenCalled();
    expect(await response?.text()).toBe('offline');
  });

  it('Immutable static assets are cached-first', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('js', {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      }),
    );

    const event = createEvent('https://example.com/_next/static/chunk.js');
    handleFetch(event as unknown as FetchEvent);

    const response = await event.responsePromise;
    expect(global.fetch).toHaveBeenCalledWith(event.request);
    expect(mockCache.put).toHaveBeenCalled();
    expect(response?.status).toBe(200);
  });

  it('RSC payloads (/_next/data/…) are never cached', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const event = createEvent(
      'https://example.com/_next/data/abc/page.json',
    );
    handleFetch(event as unknown as FetchEvent);

    await event.responsePromise;
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  it('Dynamic JSON responses not under /api/ are not cached', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const event = createEvent('https://example.com/driver/data.json');
    handleFetch(event as unknown as FetchEvent);

    await event.responsePromise;
    expect(mockCache.put).not.toHaveBeenCalled();
  });

  it('API requests are ignored entirely (no fetch, no cache)', () => {
    const event: MockEvent = {
      request: { url: 'https://example.com/api/auth/me', method: 'GET' },
      respondWith: vi.fn(),
    };
    handleFetch(event as unknown as FetchEvent);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(((global as Record<string, unknown>).caches as Record<string, unknown>).match).not.toHaveBeenCalled();
    expect(mockCache.put).not.toHaveBeenCalled();
    expect(event.respondWith).not.toHaveBeenCalled();
  });
});
