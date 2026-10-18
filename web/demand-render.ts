/** Coalesce invalidations, then render only while camera damping is moving. */
export function createDemandRender(draw: () => boolean, frames = {
  request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id),
}) {
  let pending: number | null = null;
  let disposed = false;
  function request() {
    if (disposed || pending !== null) return;
    pending = frames.request(() => {
      pending = null;
      if (!disposed && draw()) request();
    });
  }
  return {
    request,
    dispose() { disposed = true; if(pending!==null)frames.cancel(pending); pending=null; },
  };
}
