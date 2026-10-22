import type { Studio } from '../../studio.ts';
import { handleGame } from './game.ts';
import { handleLibrary } from './library.ts';
import { handlePersona } from './persona.ts';

/**
 * Compose the pack route groups. Paths are disjoint across groups; running the
 * local library before game operations keeps the game-required guard after
 * local install and before slot mutations, matching the former single handler.
 */
export async function handlePacks(
  studio: Studio,
  req: Request,
  url: URL,
  parts: string[],
): Promise<Response | null> {
  const persona = await handlePersona(studio, req, url, parts);
  if (persona) return persona;
  const library = await handleLibrary(studio, req, url, parts);
  if (library) return library;
  return handleGame(studio, req, url, parts);
}
