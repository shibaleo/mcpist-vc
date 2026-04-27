/**
 * Ed25519 keypair derived from the SERVER_JWT_SIGNING_KEY env var.
 *
 * Web Crypto's `subtle.importKey("raw", ...)` for Ed25519 only accepts
 * 32-byte *public* keys, not the seed for a private key — passing a seed
 * with `["sign"]` usage fails as "Unsupported key usage for a Ed25519 key".
 *
 * The seed itself, wrapped in a fixed ASN.1 PKCS#8 envelope, is what Node's
 * `createPrivateKey` accepts. We compute the public key as a derivation of
 * the private key, then memoise both — they're the same for the whole
 * process lifetime.
 *
 * jose accepts Node KeyObjects directly for EdDSA in Node runtimes, so
 * downstream sign/verify calls don't need any further conversion.
 */

import {
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { Buffer } from "node:buffer";

// PKCS#8 ASN.1 prefix for an Ed25519 private key. The trailing `04 20`
// (OCTET STRING, length 32) precedes the 32-byte seed.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

let cache: { privateKey: KeyObject; publicKey: KeyObject } | null = null;

function decodeSeed(b64: string): Buffer {
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `SERVER_JWT_SIGNING_KEY must be a 32-byte base64 seed (got ${buf.length} bytes)`,
    );
  }
  return buf;
}

export function loadEd25519Keypair(): {
  privateKey: KeyObject;
  publicKey: KeyObject;
} {
  if (cache) return cache;
  const seedB64 = process.env.SERVER_JWT_SIGNING_KEY;
  if (!seedB64) throw new Error("SERVER_JWT_SIGNING_KEY is not set");
  const seed = decodeSeed(seedB64);
  const der = Buffer.concat([PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({
    key: der,
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  cache = { privateKey, publicKey };
  return cache;
}

/** Test helper — drops the cached keypair so the next call re-reads env. */
export function _resetEd25519CacheForTests() {
  cache = null;
}
