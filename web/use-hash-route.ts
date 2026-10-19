import { useEffect, useState } from "react";
import { pageFromHash, pageTitles, type PageKey } from "./navigation";

/** Subscribe to the hash router and keep the document title in sync. */
export function useHashRoute(): { hash: string; page: PageKey } {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const page = pageFromHash(hash);
  useEffect(() => {
    document.title = `4DGen · ${pageTitles[page]}`;
  }, [page]);
  return { hash, page };
}
