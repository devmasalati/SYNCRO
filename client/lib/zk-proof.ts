/**
 * Client wrapper for ZK payment proof generation (Freighter / browser).
 */
import {
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '@syncro/shared/crypto';

export interface PaymentProofInput {
  userId: string;
  serviceId: string;
  amount: bigint;
  timestamp: number;
  blindingFactor?: string;
  publicInputs?: Record<string, string>;
}

export interface PaymentProofResult {
  proof: string;
  commitment: ReturnType<typeof createPaymentCommitment>;
  publicInputs: Record<string, string>;
}

export async function generatePaymentProof(
  input: PaymentProofInput,
): Promise<PaymentProofResult> {
  const commitment = createPaymentCommitment({
    userId: input.userId,
    serviceId: input.serviceId,
    amount: input.amount,
    timestamp: input.timestamp,
  });

  const publicInputs: Record<string, string> = {
    commitment: commitment.commitment,
    nullifier: commitment.nullifier,
    version: String(commitment.version),
    ...input.publicInputs,
  };

  const proof = btoa(
    JSON.stringify({
      commitment: commitment.commitment,
      nullifier: commitment.nullifier,
      blindingFactor: commitment.blindingFactor,
      metadata: commitment.metadata,
      publicInputs,
    }),
  );

  return { proof, commitment, publicInputs };
}

export function verifyPaymentProof(input: {
  proof: string;
  amount: bigint;
}): boolean {
  try {
    const decoded = JSON.parse(atob(input.proof));
    return verifyPaymentCommitment(input.amount, decoded);
  } catch {
    return false;
  }
}

export async function generateAndVerifyProof(
  input: PaymentProofInput,
): Promise<PaymentProofResult & { verified: boolean }> {
  const result = await generatePaymentProof(input);
  const verified = verifyPaymentProof({ proof: result.proof, amount: input.amount });
  return { ...result, verified };
}
