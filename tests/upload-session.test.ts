import { describe, expect, it } from 'vitest';
import { isUploadSessionId, uploadSessionId } from '../server/upload-session.ts';

describe('upload session ids', () => {
  it('produces a 36-character id that the select route accepts', () => {
    const id = uploadSessionId('a'.repeat(64));
    expect(id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(id).toHaveLength(36);
    expect(isUploadSessionId(id)).toBe(true);
  });

  it('keeps legacy 40-character pending ids usable', () => {
    expect(isUploadSessionId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('rejects malformed ids and path traversal', () => {
    expect(isUploadSessionId('')).toBe(false);
    expect(isUploadSessionId('../../etc/passwd')).toBe(false);
    expect(isUploadSessionId('a'.repeat(35))).toBe(false);
    expect(isUploadSessionId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaaaaaaa')).toBe(false);
  });
});
