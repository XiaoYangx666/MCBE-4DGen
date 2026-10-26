import { expect,test } from 'vitest';
import { createDemandRender } from '../web/shared/demand-render.ts';

test('preview coalesces changes, settles to no frames, wakes again, and cancels on dispose',()=>{
  const pending=new Map<number,FrameRequestCallback>();let id=0,draws=0,moving=2;
  const render=createDemandRender(()=>{draws++;return moving-->0;},{request:cb=>{pending.set(++id,cb);return id;},cancel:id=>{pending.delete(id);}});
  const tick=()=>{const entries=[...pending];pending.clear();for(const [,cb] of entries)cb(0);};
  render.request();render.request();render.request();expect(pending.size).toBe(1);
  tick();tick();tick();expect(draws).toBe(3);expect(pending.size).toBe(0);
  tick();expect(draws).toBe(3);
  render.request();tick();expect(draws).toBe(4);expect(pending.size).toBe(0);
  render.request();render.dispose();expect(pending.size).toBe(0);
  render.request();expect(pending.size).toBe(0);
});
