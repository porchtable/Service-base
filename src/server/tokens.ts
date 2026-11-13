import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit random, URL-safe token. Only its SHA-256 hash is ever stored. */
export function generateToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Cheap shape check before touching the database (43 base64url chars for 32 bytes). */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
