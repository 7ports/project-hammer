/**
 * AIS proxy — re-exports shared types from ./types and exposes the singleton
 * provider manager as `aisProxy`.
 *
 * The `AISProxy` named export is kept for backward-compatibility with tests
 * that do `import type { AISProxy } from './aisProxy'` or call `new AISProxy()`.
 * New code should import from `./providerManager` directly.
 */

export type { VesselPosition, AISProxyDiagnostics, PositionListener, Unsubscribe } from './types';
export { AISProviderManager as AISProxy } from './providerManager';
export { createProviderManager } from './providerManager';
export type { StatusChangeCallback } from './providerManager';

import { createProviderManager } from './providerManager';

/** Shared provider manager singleton. Call `aisProxy.connect()` once at server startup. */
export const aisProxy = createProviderManager();
