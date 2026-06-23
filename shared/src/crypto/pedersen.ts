import { ed25519 } from '@noble/curves/ed25519';

// Helper functions first
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

function randomScalar(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToScalar(bytes);
}

function bytesToScalar(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result % ed25519.CURVE.n;
}

function scalarToHex(scalar: bigint): string {
  return scalar.toString(16).padStart(64, '0');
}

// Pedersen commitment parameters (using ed25519 base point and another generator)
const G = ed25519.ExtendedPoint.BASE;
// Use another valid ed25519 public key as H (generated from a known private key)
const hPriv = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const hPub = ed25519.getPublicKey(hPriv);
const H = ed25519.ExtendedPoint.fromHex(bytesToHex(hPub));

export interface PedersenCommitment {
  commitment: string;
  blindingFactor: string;
}

/**
 * Creates a Pedersen commitment to a value.
 * @param value Value to commit to (as bigint).
 * @param blindingFactor Optional blinding factor (random if not provided).
 * @returns Pedersen commitment object.
 */
export function commit(value: bigint, blindingFactor?: bigint): PedersenCommitment {
  const r = blindingFactor || randomScalar();
  const vG = G.multiply(value);
  const rH = H.multiply(r);
  const commitment = vG.add(rH);
  return {
    commitment: commitment.toHex(),
    blindingFactor: scalarToHex(r),
  };
}

/**
 * Verifies a Pedersen commitment.
 * @param value The value that was committed to.
 * @param blindingFactor The blinding factor used.
 * @param commitment The commitment to verify.
 * @returns True if the commitment is valid.
 */
export function verify(value: bigint, blindingFactor: bigint, commitment: string): boolean {
  const vG = G.multiply(value);
  const rH = H.multiply(blindingFactor);
  const expectedCommitment = vG.add(rH);
  return expectedCommitment.toHex() === commitment;
}
