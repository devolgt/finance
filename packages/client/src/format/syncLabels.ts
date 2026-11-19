import type { SyncPlatform } from '@finance/core';

/** Nome de cada plataforma na lista de aparelhos. */
export const SYNC_PLATFORM_LABELS: Readonly<Record<SyncPlatform, string>> = {
    desktop: 'Desktop',
    android: 'Android',
    ios: 'iOS',
};
