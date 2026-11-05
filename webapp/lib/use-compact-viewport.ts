import { useEffect, useState } from 'react';
import { COMPACT_QUERY } from './viewport';

function isCompact() {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('mobile')) return true;
    if (params.has('desktop')) return false;
  }
  return window.matchMedia(COMPACT_QUERY).matches;
}

/** Reactive version of the layout breakpoint used by the model workbench. */
export function useCompactViewport() {
  const [compact, setCompact] = useState(isCompact);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(isCompact());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}
