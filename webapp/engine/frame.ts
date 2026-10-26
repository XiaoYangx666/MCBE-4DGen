/** Yield to the browser paint loop, with a timeout for background tabs. */
export const nextFrame = () => new Promise<void>((resolve) => {
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  requestAnimationFrame(() => setTimeout(done, 0));
  // rAF pauses in background tabs; keep the pipeline from stalling there.
  setTimeout(done, 80);
});
