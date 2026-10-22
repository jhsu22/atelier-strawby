import { createHash } from 'node:crypto';
export const digest = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
/** UUIDv5 with a permanent application namespace and unambiguous tuple encoding. */
export function stableId(...parts: (string | number)[]): string {
  const hash = createHash('sha1').update(Buffer.from('b7e289a72e4f51ffac229e7b184aeb3d', 'hex')).update(JSON.stringify(parts)).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.toString('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const searchKey = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
