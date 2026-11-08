import { vi, describe, it, expect, beforeEach } from 'vitest';

const SW_PATH = '../../../../public/sw.js';

let capturedAssets: string[] | undefined;
let installCallback: ((e: { waitUntil: (p: Promise<unknown>) => void }) => void) | undefined;

function resetEnvironment() {
  capturedAssets = undefined;
  installCallback = undefined;

  // Mock Cache API
  const mockCache = {
    addAll: vi.fn(async (assets: string[]) => {
      capturedAssets = assets;
    }),
  };

  (global as Record<string, unknown>).caches = {
    open: vi.fn(() => Promise.resolve(mockCache)),
    match: vi.fn(() => Promise.resolve(undefined)),
    delete: vi.fn(() => Promise.resolve(true)),
    keys: vi.fn(() => Promise.resolve([])),
  };

  // Mock Service-Worker global `self`
  const mockSelf = {
    addEventListener: (type: string, cb: typeof installCallback) => {
      if (type === 'install') installCallback = cb;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };

  (global as Record<string, unknown>).self = mockSelf;

  // Clear module cache so the SW script runs fresh with our mocks
  vi.resetModules();
}

describe('Service Worker installation', () => {
  beforeEach(async () => {
    resetEnvironment();
    // Re-import the SW after setting up mocks
    await import(SW_PATH);
  });

  it('does not precache navigation routes "/" and "/driver"', async () => {
    // Capture the promise passed to waitUntil so we can await it
    let waitPromise: Promise<unknown> | undefined;
    const event = {
      waitUntil: (p: Promise<unknown>) => {
        waitPromise = p;
      },
    };
    installCallback?.(event);
    await waitPromise;

    expect(capturedAssets).toBeDefined();
    expect(capturedAssets).toEqual([
      '/offline.html',
      '/manifest.json',
      '/icon-192.svg',
      '/icon-512.svg',
    ]);
  });

  it('ensures offline fallback page is cached for navigation fallback', async () => {
    let waitPromise: Promise<unknown> | undefined;
    const event = {
      waitUntil: (p: Promise<unknown>) => {
        waitPromise = p;
      },
    };
    installCallback?.(event);
    await waitPromise;

    expect(capturedAssets).toContain('/offline.html');
  });
});
