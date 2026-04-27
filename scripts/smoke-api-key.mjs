/**
 * Smoke test: issue an Ed25519 API-key JWT and verify it round-trips.
 * Catches "Unsupported key usage" early without spinning up the dev server.
 */

import "dotenv/config";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { Buffer } from "node:buffer";
import * as jose from "jose";

const seedB64 = process.env.SERVER_JWT_SIGNING_KEY;
if (!seedB64) {
  console.error("SERVER_JWT_SIGNING_KEY missing");
  process.exit(1);
}
const seed = Buffer.from(seedB64, "base64");
if (seed.length !== 32) {
  console.error(`seed must be 32 bytes, got ${seed.length}`);
  process.exit(1);
}

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const der = Buffer.concat([PKCS8_PREFIX, seed]);
const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
const publicKey = createPublicKey(privateKey);

const kid = crypto.randomUUID();
const jwt = await new jose.SignJWT({ sub: "test-user" })
  .setProtectedHeader({ alg: "EdDSA", kid })
  .setIssuedAt()
  .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
  .sign(privateKey);

console.log("→ token:", `mcpist_${jwt.slice(0, 40)}…`);

const { payload, protectedHeader } = await jose.jwtVerify(jwt, publicKey, {
  algorithms: ["EdDSA"],
});
console.log("✓ verified — kid:", protectedHeader.kid, "sub:", payload.sub);
