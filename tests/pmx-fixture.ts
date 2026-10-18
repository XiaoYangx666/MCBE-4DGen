/** Independently authored tiny PMX, not derived from a third-party mesh. */
export function pmxFixture(encoding: 0 | 1 = 0, indexSize: 1 | 2 | 4 = 1, version: 2 | 2.1 = 2, extraUV = 0) {
  const chunks: Buffer[] = [];
  const u8 = (n: number) => { const b = Buffer.alloc(1); b.writeUInt8(n); chunks.push(b); };
  const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); chunks.push(b); };
  const f = (...values: number[]) => { const b = Buffer.alloc(values.length * 4); values.forEach((n, i) => b.writeFloatLE(n, i * 4)); chunks.push(b); };
  const index = (n: number) => { const b = Buffer.alloc(indexSize); b.writeIntLE(n, 0, indexSize); chunks.push(b); };
  const text = (s: string) => { const b = Buffer.from(s, encoding ? 'utf8' : 'utf16le'); i32(b.length); chunks.push(b); };
  chunks.push(Buffer.from('PMX ')); f(version); u8(8); u8(encoding); u8(extraUV);
  for (let i = 0; i < 6; i++) u8(indexSize);
  for (const s of ['中文角色', 'Synthetic Avatar', 'Original test fixture', 'No third-party content']) text(s);
  i32(6);
  for (let t = 0; t < 2; t++) for (const [x, y, u, v] of [[0, 0, 0, 0], [1, 0, 1, 0], [0, 1, 0, 1]]) {
    f(x! + t * 2, y!, 0, 0, 0, -1, u!, v!);
    for (let i = 0; i < extraUV; i++) f(0.1, 0.2, 0.3, 0.4);
    u8(0); index(t); f(1);
  }
  i32(6); for (let i = 0; i < 6; i++) index(i);
  i32(2); text('贴图\\脸.png'); text('贴图\\衣服.png');
  i32(2);
  for (let i = 0; i < 2; i++) {
    text(i ? '衣服' : '脸'); text(i ? 'clothes' : 'face');
    f(1, 1, 1, i ? 0.5 : 1, 0, 0, 0, 0, 0, 0, 0); u8(i === 0 ? 1 : 0);
    f(0, 0, 0, 1, 0); index(i); index(-1); u8(0); u8(1); u8(0); text(''); i32(3);
  }
  i32(2);
  for (let i = 0; i < 2; i++) {
    text(i ? '上半身' : '全ての親'); text(i ? 'body' : 'root'); f(0, i, 0); index(i ? 0 : -1); i32(0);
    chunks.push(Buffer.from([0, 0])); f(0, 1, 0); // no bone flags; tail is offset
  }
  for (let i = 0; i < 4; i++) i32(0); // morph, display frames, rigid bodies, joints
  if (version === 2.1) i32(0); // soft bodies
  return Buffer.concat(chunks);
}
