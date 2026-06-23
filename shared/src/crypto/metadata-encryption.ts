export interface EncryptedData {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Encrypts metadata using AES-256-GCM via Web Crypto API.
 * Works in both browser and Node.js.
 * @param plaintext Plain text to encrypt.
 * @param keyHex 32-byte encryption key as hex string.
 * @returns Encrypted data with IV and auth tag.
 */
export async function encryptMetadata(plaintext: string, keyHex: string): Promise<EncryptedData> {
  const keyBytes = hexToBytes(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  );
  const ciphertextWithTag = new Uint8Array(ciphertextBuffer);
  const authTag = ciphertextWithTag.slice(-16); // GCM auth tag is 16 bytes
  const ciphertext = ciphertextWithTag.slice(0, -16);

  return {
    iv: bytesToHex(iv),
    authTag: bytesToHex(authTag),
    ciphertext: bytesToHex(ciphertext),
  };
}

/**
 * Decrypts metadata encrypted with encryptMetadata.
 * @param encrypted Encrypted data object.
 * @param keyHex 32-byte encryption key as hex string.
 * @returns Decrypted plain text.
 */
export async function decryptMetadata(encrypted: EncryptedData, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const iv = hexToBytes(encrypted.iv);
  const authTag = hexToBytes(encrypted.authTag);
  const ciphertext = hexToBytes(encrypted.ciphertext);
  const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(authTag, ciphertext.length);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertextWithTag
    );
    return new TextDecoder().decode(plaintextBuffer);
  } catch {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
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
