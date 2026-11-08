// Service Worker activation test – verifies cache migration from v1 to v2
import { vi, describe, it, expect, beforeEach } from 'vitest';

const SW_PATH = '../../../../public/sw.js';

let activateCallback:
  | ((e: { waitUntil: (p: Promise<unknown>) => void }) => void)
  | undefined;
let deleteCalls: string[] = [];
let claimCalled = false;

function resetEnvironment() {
  activateCallback = undefined;
  deleteCalls = [];
  claimCalled = false;

  (global as Record<string, unknown>).caches = {
    keys: vi.fn(() =>
      Promise.resolve(['fleetproof-shell-v1', 'fleetproof-shell-v2']),
    ),
    delete: vi.fn((name: string) => {
      deleteCalls.push(name);
      return Promise.resolve(true);
    }),
    open: vi.fn(() => Promise.resolve({ addAll: vi.fn() })),
    match: vi.fn(() => Promise.resolve(undefined)),
  };

  // Mock Service-Worker global `self`
  const mockSelf = {
    addEventListener: (type: string, cb: typeof activateCallback) => {
      if (type === 'activate') activateCallback = cb;
    },
    clients: {
      claim: vi.fn(() => {
        claimCalled = true;
      }),
    },
    skipWaiting: vi.fn(),
  };

  (global as Record<string, unknown>).self = mockSelf;

  // Reset Vitest module registry so the SW script re-executes with mocks
  vi.resetModules();
}

describe('Service Worker activation (cache migration)', () => {
  beforeEach(async () => {
    resetEnvironment();
    // Re-import the SW after setting up mocks
    await import(SW_PATH);
  });

  it('deletes previous v1 cache and retains v2 cache, then claims clients', async () => {
    // Capture and await the promise passed to waitUntil
    let waitPromise: Promise<unknown> | undefined;
    const event = {
      waitUntil: (p: Promise<unknown>) => {
        waitPromise = p;
      },
    };
    activateCallback?.(event);
    await waitPromise;

    // v1 should be deleted, v2 should stay
    expect(deleteCalls).toContain('fleetproof-shell-v1');
    expect(deleteCalls).not.toContain('fleetproof-shell-v2');

    // clients.claim should have been called
    expect(claimCalled).toBe(true);
  });
});
