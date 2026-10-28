/** Single source of truth for the layout breakpoint used by the web app. */
export const COMPACT_QUERY = '(max-width: 860px)';

export function isCompactViewport() {
  return typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches;
}

export function isCoarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
