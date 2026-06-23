import * as pedersen from './pedersen';
import { sha256 } from '@noble/hashes/sha256';

export interface PaymentCommitment {
  amountCommitment: string;
  amountBlindingFactor: string;
  metadata: string;
}

/**
 * Creates a payment commitment for a given amount and metadata.
 * @param amount Payment amount (as bigint).
 * @param metadata Optional metadata to include.
 * @returns Payment commitment object.
 */
export function createPaymentCommitment(amount: bigint, metadata: string = ''): PaymentCommitment {
  const { commitment, blindingFactor } = pedersen.commit(amount);
  const metadataHash = bytesToHex(sha256(new TextEncoder().encode(metadata)));
  return {
    amountCommitment: commitment,
    amountBlindingFactor: blindingFactor,
    metadata: metadataHash,
  };
}

/**
 * Verifies a payment commitment.
 * @param amount The amount that was committed to.
 * @param commitment The payment commitment to verify.
 * @returns True if the commitment is valid.
 */
export function verifyPaymentCommitment(amount: bigint, commitment: PaymentCommitment): boolean {
  return pedersen.verify(amount, hexToScalar(commitment.amountBlindingFactor), commitment.amountCommitment);
}

function hexToScalar(hex: string): bigint {
  return BigInt('0x' + hex);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
