/**
 * Content-addressed upload folder id. The select route resolves this id back to
 * a folder, so both sides must agree on the exact shape: 8-4-4-4-12 hex.
 */
export function uploadSessionId(digest: string): string {
  if (!/^[0-9a-f]{32,64}$/i.test(digest)) throw new Error('Invalid upload digest');
  const hex = digest.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Accept the current 36-character id and the legacy 40-character form. */
export function isUploadSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12,16}$/.test(value);
}
