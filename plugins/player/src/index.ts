import { registerPlugin } from '@capacitor/core';
import type { MeloPlayerPlugin } from './definitions';

export const MeloPlayer = registerPlugin<MeloPlayerPlugin>('MeloPlayer', {
  web: () => import('./web').then((m) => new m.MeloPlayerWeb())
});

export * from './definitions';
