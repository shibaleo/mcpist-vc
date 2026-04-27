/**
 * AES-256-GCM credential encryption.
 *
 * WIRE-COMPATIBLE with the legacy Go implementation
 * (apps/server/internal/db/encryption.go). The DB stores rows produced by
 * Go's `gcm.Seal(nonce, nonce, plaintext, nil)`, which is layout
 *
 *     nonce(12) || ciphertext || tag(16)
 *
 * base64-encoded with the optional "v1:" version prefix. Web Crypto's
 * AES-GCM mode accepts the same `ciphertext || tag` blob as input, so the
 * only adjustment is splitting off the leading 12-byte nonce.
 *
 * Phase 2 of the migration plan calls out cross-impl decryption as the #1
 * risk; this implementation is the new side of that compat test.
 */

const VERSION_PREFIX = "v1:";
const NONCE_BYTES = 12; // GCM standard, matches Go's gcm.NonceSize() default
const KEY_BYTES = 32; // AES-256

let cachedKey: CryptoKey | null = null;

/**
 * Returns a Uint8Array backed by a fresh ArrayBuffer (not SharedArrayBuffer
 * or a generic ArrayBufferLike). Web Crypto's BufferSource only accepts the
 * concrete ArrayBuffer-backed view, and TS strict mode now distinguishes the
 * two at the type level.
 */
function decodeBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");
  }
  const keyBytes = decodeBase64(raw);
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be 32 bytes base64-encoded (got ${keyBytes.length} bytes)`,
    );
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

/**
 * Encrypt plaintext bytes. Returns "v1:" + base64(nonce || ciphertext+tag).
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const nonce = crypto.getRandomValues(
    new Uint8Array(new ArrayBuffer(NONCE_BYTES)),
  );
  const data = new TextEncoder().encode(plaintext);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data),
  );
  const out = new Uint8Array(new ArrayBuffer(nonce.length + sealed.length));
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return VERSION_PREFIX + encodeBase64(out);
}

/**
 * Decrypt a "v1:base64(nonce || ciphertext+tag)" blob (also accepts the
 * un-prefixed form for legacy data).
 */
export async function decrypt(ciphertext: string): Promise<string> {
  const data = ciphertext.startsWith(VERSION_PREFIX)
    ? ciphertext.slice(VERSION_PREFIX.length)
    : ciphertext;
  const raw = decodeBase64(data);
  if (raw.length < NONCE_BYTES) {
    throw new Error("ciphertext too short");
  }
  const nonce = raw.slice(0, NONCE_BYTES);
  const sealed = raw.slice(NONCE_BYTES);
  const key = await getKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    sealed,
  );
  return new TextDecoder().decode(plain);
}
