import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

// Local credentials and fixture data must never reach a real backend in unit tests.
vi.stubEnv('VITE_XANO_SYNC_ENABLED', 'false');

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
