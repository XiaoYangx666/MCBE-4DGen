import { gameRoutes } from './game.ts';
import { libraryRoutes } from './library.ts';
import { personaRoutes } from './persona.ts';

/**
 * Paths are disjoint across the three pack domains, so declaration order only
 * affects readability. Game mutations keep their own guard in `game.ts`.
 */
export const packRoutes = [
  ...personaRoutes,
  ...libraryRoutes,
  ...gameRoutes,
];
