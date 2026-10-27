/**
 * Yield to the browser paint loop, with a timeout for background tabs. The
 * Node test environment has no requestAnimationFrame, so fall back to a
 * macrotask there instead of throwing.
 */
export const nextFrame = () => new Promise<void>((resolve) => {
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(done, 0));
  } else {
    setTimeout(done, 0);
  }
  // rAF pauses in background tabs; keep the pipeline from stalling there.
  setTimeout(done, 80);
});
