import { test } from 'vitest';
import assert from 'node:assert/strict';
import { decodeTGA } from '../src/tga.ts';

function header(imageType: number, width: number, height: number, depth: number, descriptor: number) {
  const bytes = new Uint8Array(18);
  bytes[2] = imageType;
  bytes[12] = width & 0xff; bytes[13] = width >> 8;
  bytes[14] = height & 0xff; bytes[15] = height >> 8;
  bytes[16] = depth; bytes[17] = descriptor;
  return bytes;
}

test('decodes RLE 32-bit TGA with bottom-left origin', () => {
  const bytes = new Uint8Array(18 + 1 + 16);
  bytes.set(header(10, 2, 2, 32, 0x08));
  let offset = 18;
  bytes[offset++] = 0x03; // raw packet with four pixels
  for (const [b, g, r, a] of [[0, 0, 255, 255], [0, 255, 0, 255], [255, 0, 0, 255], [255, 255, 255, 255]] as const) {
    bytes[offset++] = b; bytes[offset++] = g; bytes[offset++] = r; bytes[offset++] = a;
  }
  const image = decodeTGA(bytes);
  assert.equal(image.width, 2); assert.equal(image.height, 2);
  assert.deepEqual([...image.data], [
    0, 0, 255, 255, 255, 255, 255, 255,
    255, 0, 0, 255, 0, 255, 0, 255,
  ]);
});

test('decodes an RLE run and top-origin 24-bit TGA', () => {
  const bytes = new Uint8Array(18 + 1 + 3);
  bytes.set(header(10, 3, 1, 24, 0x20));
  bytes[18] = 0x82; // RLE run of three identical pixels
  bytes[19] = 10; bytes[20] = 20; bytes[21] = 30;
  const image = decodeTGA(bytes);
  assert.deepEqual([...image.data], [
    30, 20, 10, 255, 30, 20, 10, 255, 30, 20, 10, 255,
  ]);
});

test('rejects compressed or truncated files', () => {
  assert.throws(() => decodeTGA(new Uint8Array(4)), /truncated header/);
  const truncated = new Uint8Array(18); truncated.set(header(10, 4, 4, 32, 0x08));
  assert.throws(() => decodeTGA(truncated), /truncated/);
});
