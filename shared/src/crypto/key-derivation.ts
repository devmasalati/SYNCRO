import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

export interface HKDFOptions {
  salt?: Uint8Array;
  info?: Uint8Array;
  length?: number;
}

/**
 * Derives a key using HKDF from Stellar keys or other secret material.
 * @param ikm Input key material (secret).
 * @param options HKDF options (salt, info, length).
 * @returns Derived key as Uint8Array.
 */
export function deriveKey(ikm: Uint8Array, options: HKDFOptions = {}): Uint8Array {
  const salt = options.salt || new Uint8Array(0);
  const info = options.info || new Uint8Array(0);
  const length = options.length || 32;

  return hkdf(sha256, ikm, salt, info, length);
}

/**
 * Convenience function to derive key from hex string.
 * @param ikmHex Input key material as hex string.
 * @param options HKDF options.
 * @returns Derived key as hex string.
 */
export function deriveKeyHex(ikmHex: string, options: HKDFOptions = {}): string {
  const ikm = hexToBytes(ikmHex);
  const derived = deriveKey(ikm, options);
  return bytesToHex(derived);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
