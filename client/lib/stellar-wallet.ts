import { getBlockchainFlags } from '../../shared/blockchain-flags';
import { deriveSubscriptionEncryptionKey, deriveKeyHex } from '../../shared/src/crypto/key-derivation';
import {
  encodeStealthMetaAddress,
  generateStealthMetaAddress,
  type StealthMetaAddress,
} from '../../shared/src/types/stealth';

type WalletInfo = {
  publicKey: string;
  network: 'testnet' | 'mainnet';
  connectedAt: number;
};

type WalletEventType = 'walletConnected' | 'walletDisconnected' | 'walletChanged';
type WalletEventHandler = (info?: WalletInfo, oldInfo?: WalletInfo) => void;

class StellarWalletService {
  private wallet: WalletInfo | null = null;
  private listeners: Map<WalletEventType, Set<WalletEventHandler>> = new Map();
  private readonly STORAGE_KEY = 'stellar_wallet_session';
  /** In-memory session cache for derived encryption key — never persisted. */
  private _encryptionKey: string | null = null;
  private readonly STEALTH_STORAGE_KEY = 'syncro_stealth_meta_address';
  private readonly STEALTH_PAYMENTS_KEY = 'syncro_stealth_payment_history';

  constructor() {
    this.loadSession();
  }

  async connect(network: 'testnet' | 'mainnet' = 'testnet'): Promise<WalletInfo> {
    if (typeof window === 'undefined') throw new Error('Wallet connection requires browser');

    // Guard: testnet wallet connections are not permitted in production unless
    // NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS=true is explicitly set.
    const flags = getBlockchainFlags();
    if (network === 'testnet' && flags.isProduction && !flags.testnetActionsEnabled) {
      throw new Error(
        '[wallet] Connecting to testnet is not permitted in production. ' +
          'Set NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS=true to allow this (non-mainnet only).',
      );
    }

    const freighter = (window as any).freighter;
    if (!freighter) throw new Error('Freighter wallet not installed');

    const publicKey = await freighter.getPublicKey();
    if (!publicKey) throw new Error('Failed to get public key');

    const oldWallet = this.wallet;
    const isWalletChange = oldWallet && oldWallet.publicKey !== publicKey;

    this.wallet = { publicKey, network, connectedAt: Date.now() };
    this.saveSession();

    if (isWalletChange) {
      // Emit wallet change event with both old and new wallet info
      this.emit('walletChanged', this.wallet, oldWallet);
    } else {
      this.emit('walletConnected', this.wallet);
    }

    return this.wallet;
  }

  disconnect(): void {
    const wasConnected = this.wallet !== null;
    this.wallet = null;
    this._encryptionKey = null;
    this.clearSession();
    if (wasConnected) this.emit('walletDisconnected');
  }

  getWallet(): WalletInfo | null {
    return this.wallet;
  }

  isConnected(): boolean {
    return this.wallet !== null;
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.wallet) throw new Error('Wallet not connected');

    const freighter = (window as any).freighter;
    if (!freighter) throw new Error('Freighter wallet not available');

    const signedXdr = await freighter.signTransaction(xdr, {
      network: this.wallet.network === 'mainnet' ? 'PUBLIC' : 'TESTNET',
      networkPassphrase: this.wallet.network === 'mainnet' 
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015',
    });

    return signedXdr;
  }

  /**
   * Derives and caches the AES-256 encryption key for this session using
   * HKDF-SHA256 from the Stellar Ed25519 seed.
   *
   * The derived key is held in memory only — never written to disk or DB.
   * Call this once per session after the user provides their secret key seed.
   *
   * @param stellarSecretKeySeed - Raw 32-byte Ed25519 seed.
   */
  deriveAndCacheEncryptionKey(stellarSecretKeySeed: Uint8Array): void {
    this._encryptionKey = deriveSubscriptionEncryptionKey(stellarSecretKeySeed);
  }

  /**
   * Returns the in-memory encryption key for this session, or null if not yet derived.
   */
  getEncryptionKey(): string | null {
    return this._encryptionKey;
  }

  on(event: WalletEventType, handler: WalletEventHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: WalletEventType, handler: WalletEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  private emit(event: WalletEventType, info?: WalletInfo, oldInfo?: WalletInfo): void {
    this.listeners.get(event)?.forEach(handler => handler(info, oldInfo));
  }

  /**
   * Derives an encryption key from the wallet's public key using HKDF-SHA256
   * @param salt Optional salt for key derivation (defaults to 'syncro-encryption')
   * @returns Hex-encoded 256-bit encryption key
   */
  deriveEncryptionKey(publicKey?: string, salt: string = 'syncro-encryption'): string {
    const key = publicKey || this.wallet?.publicKey;
    if (!key) throw new Error('No wallet connected for key derivation');

    const encoder = new TextEncoder();
    const saltBytes = encoder.encode(salt);
    const info = encoder.encode('subscription-metadata-encryption-v1');

    return deriveKeyHex(key, {
      salt: saltBytes,
      info: info,
      length: 32,
    });
  }

  /** Generate and persist a one-time stealth meta-address for privacy payments */
  generateStealthMetaAddress(): StealthMetaAddress {
    const meta = generateStealthMetaAddress();
    this.saveStealthMetaAddress(meta);
    return meta;
  }

  getStealthMetaAddress(): StealthMetaAddress | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(this.STEALTH_STORAGE_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored) as StealthMetaAddress;
    } catch {
      return null;
    }
  }

  saveStealthMetaAddress(meta: StealthMetaAddress): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.STEALTH_STORAGE_KEY, JSON.stringify(meta));
  }

  /** Append a stealth payment record for local audit (unlinkable on-chain) */
  recordStealthPayment(record: {
    subscriptionId: string;
    stealthAddress: string;
    ephemeralPubkey: string;
    amount: number;
    timestamp: string;
  }): void {
    if (typeof window === 'undefined') return;
    const existing = this.getStealthPaymentHistory();
    existing.push(record);
    localStorage.setItem(this.STEALTH_PAYMENTS_KEY, JSON.stringify(existing));
  }

  getStealthPaymentHistory(): Array<{
    subscriptionId: string;
    stealthAddress: string;
    ephemeralPubkey: string;
    amount: number;
    timestamp: string;
  }> {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(this.STEALTH_PAYMENTS_KEY);
    if (!stored) return [];
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  encodeStealthMetaAddress(spendingPubkey: string, viewingPubkey: string): string {
    return encodeStealthMetaAddress({ spendingPubkey, viewingPubkey });
  }

  private saveSession(): void {
    if (typeof window === 'undefined' || !this.wallet) return;
    sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.wallet));
  }

  private loadSession(): void {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      try {
        this.wallet = JSON.parse(stored);
      } catch {}
    }
  }

  private clearSession(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(this.STORAGE_KEY);
  }
}

export const stellarWallet = new StellarWalletService();
export type { WalletInfo, WalletEventType };
