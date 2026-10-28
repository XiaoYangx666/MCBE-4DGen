import { useEffect, useState } from 'react';
import { COMPACT_QUERY } from './viewport';

function isCompact() {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('mobile'))
    return true;
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
