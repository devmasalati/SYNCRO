import logger from '../config/logger';
import { supabase } from '../config/database';
import { deriveEphemeralStealthAddress } from '@syncro/shared/crypto';
import type { StealthPaymentRecord } from '@syncro/shared';

/**
 * Scans for payments to derived stealth addresses so users can audit
 * their own payment history without exposing wallet↔merchant links on-chain.
 */
export class StealthScanner {
  async scanForPayments(userId: string): Promise<StealthPaymentRecord[]> {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stealth_meta_address')
      .eq('id', userId)
      .single();

    const metaRaw = profile?.stealth_meta_address as string | null;
    if (!metaRaw) return [];

    const parts = metaRaw.replace('syncro:stealth:v1:', '').split(':');
    if (parts.length !== 2) return [];

    const [spendPubkey, viewPubkey] = parts;
    const metaAddress = { spendPublicKey: spendPubkey, viewPublicKey: viewPubkey };

    const { data: subs } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId);

    const records: StealthPaymentRecord[] = [];

    for (const sub of subs ?? []) {
      const { data: logs } = await supabase
        .from('renewal_logs')
        .select('approval_id, transaction_hash, created_at')
        .eq('subscription_id', sub.id)
        .eq('status', 'success')
        .not('stealth_address', 'is', null);

      for (const log of logs ?? []) {
        const cycleId = `${sub.id}:${log.approval_id ?? '0'}`;
        try {
          const { ephemeralPubkey, stealthAddress } = deriveEphemeralStealthAddress(
            metaAddress,
            cycleId,
          );
          records.push({
            subscriptionId: sub.id,
            approvalId: String(log.approval_id ?? ''),
            stealthAddress,
            ephemeralPubkey,
            amount: 0,
            cycleId,
            createdAt: log.created_at,
            transactionHash: log.transaction_hash ?? undefined,
          });
        } catch (err) {
          logger.warn('Stealth scan derivation failed', {
            subscriptionId: sub.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return records;
  }
}

export const stealthScanner = new StealthScanner();
