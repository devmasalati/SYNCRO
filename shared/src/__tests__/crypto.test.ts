import {
  deriveKey,
  deriveKeyHex,
  encryptMetadata,
  decryptMetadata,
  ed25519ToCurve25519PubKey,
  ed25519ToCurve25519SecKey,
  deriveStealthAddress,
  deriveStealthSecretKey,
  commit,
  verify,
  buildMerkleTree,
  getMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../crypto';

describe('Crypto Utilities', () => {
  describe('Key Derivation (HKDF)', () => {
    it('should derive a key from input material', () => {
      const ikm = new Uint8Array([1, 2, 3, 4, 5]);
      const derived = deriveKey(ikm);
      expect(derived.length).toBe(32);
    });

    it('should derive same key for same inputs', () => {
      const ikm = '0102030405';
      const derived1 = deriveKeyHex(ikm);
      const derived2 = deriveKeyHex(ikm);
      expect(derived1).toBe(derived2);
    });
  });

  describe('Metadata Encryption', () => {
    it('should encrypt and decrypt metadata', async () => {
      const key = 'a'.repeat(64); // 32-byte key as hex
      const plaintext = 'Hello, World!';
      const encrypted = await encryptMetadata(plaintext, key);
      const decrypted = await decryptMetadata(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Pedersen Commitments', () => {
    it('should create and verify a commitment', () => {
      const value = 100n;
      const { commitment, blindingFactor } = commit(value);
      const isValid = verify(value, BigInt('0x' + blindingFactor), commitment);
      expect(isValid).toBe(true);
    });

    it('should fail verification for wrong value', () => {
      const value = 100n;
      const { commitment, blindingFactor } = commit(value);
      const isValid = verify(200n, BigInt('0x' + blindingFactor), commitment);
      expect(isValid).toBe(false);
    });
  });

  describe('Merkle Tree', () => {
    const leaves = ['a', 'b', 'c', 'd'];

    it('should build a Merkle tree and get root', () => {
      const tree = buildMerkleTree(leaves);
      const root = getMerkleRoot(leaves);
      expect(tree[tree.length - 1][0]).toBe(root);
    });

    it('should generate and verify a Merkle proof', () => {
      const proof = generateMerkleProof(leaves, 1);
      const isValid = verifyMerkleProof(proof);
      expect(isValid).toBe(true);
    });
  });

  describe('Payment Commitment', () => {
    it('should create and verify a payment commitment', () => {
      const amount = 500n;
      const commitment = createPaymentCommitment(amount);
      const isValid = verifyPaymentCommitment(amount, commitment);
      expect(isValid).toBe(true);
    });
  });
});
