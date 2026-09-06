import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const KEY_PREFIX = "ig_sk";
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export const TIERS: Record<string, number> = {
  standard: 1,
  plus: 5,
  scale: 20,
};

export function tierMultiplier(tier: string): number {
  return TIERS[tier] ?? 1;
}

export function isValidTier(tier: string): boolean {
  return tier in TIERS;
}

export interface GeneratedKey {
  publicKey: string;
  prefix: string;
  secret: string;
  salt: string;
  hashedSecret: string;
  pepperVersion: number;
}

export interface StoredKey {
  id: string;
  orgId: string;
  prefix: string;
  salt: string;
  hashedSecret: string;
  pepperVersion: number;
  scopes: string[];
  tier: string;
  lastUsedAt: number | null;
  expiresAt: number | null;
  rotatedFromId: string | null;
  revokedAt: number | null;
  createdAt: number;
}

function base62(bytes: Buffer, length: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  let i = 0;
  while (out.length < length) {
    if (i >= bytes.length) {
      i = 0;
    }
    out += alphabet[bytes[i] % 62];
    i += 1;
  }
  return out;
}

export function hashSecret(secret: string, salt: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`${salt}:${secret}`).digest("hex");
}

export function generateKey(orgId: string, scopes: string[], pepper: string, pepperVersion: number, tier = "standard"): GeneratedKey & { record: Omit<StoredKey, "id" | "createdAt"> } {
  const prefixBytes = randomBytes(6);
  const secretBytes = randomBytes(24);
  const prefix = base62(prefixBytes, 6);
  const secret = base62(secretBytes, 32);
  const salt = randomBytes(16).toString("hex");
  const hashedSecret = hashSecret(secret, salt, pepper);
  const publicKey = `${KEY_PREFIX}_${prefix}_${secret}`;
  return {
    publicKey,
    prefix,
    secret,
    salt,
    hashedSecret,
    pepperVersion,
    record: {
      orgId,
      prefix,
      salt,
      hashedSecret,
      pepperVersion,
      scopes,
      tier,
      lastUsedAt: null,
      expiresAt: null,
      rotatedFromId: null,
      revokedAt: null,
    },
  };
}

export function parseKey(publicKey: string): { prefix: string; secret: string } | null {
  const parts = publicKey.split("_");
  if (parts.length !== 4 || parts[0] !== "ig" || parts[1] !== "sk") {
    return null;
  }
  const prefix = parts[2];
  const secret = parts[3];
  if (!prefix || !secret || prefix.length < 4 || secret.length < 16) {
    return null;
  }
  return { prefix, secret };
}

export function verifySecret(secret: string, stored: Pick<StoredKey, "salt" | "hashedSecret">, pepper: string): boolean {
  const candidate = hashSecret(secret, stored.salt, pepper);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(stored.hashedSecret, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function verifyWithPepperRotation(
  secret: string,
  stored: Pick<StoredKey, "salt" | "hashedSecret" | "pepperVersion">,
  peppers: Map<number, string>,
): boolean {
  const current = peppers.get(stored.pepperVersion);
  if (current && verifySecret(secret, stored, current)) {
    return true;
  }
  for (const [version, pepper] of peppers) {
    if (version === stored.pepperVersion) {
      continue;
    }
    if (verifySecret(secret, stored, pepper)) {
      return true;
    }
  }
  return false;
}

export function isKeyActive(key: StoredKey, now: number): boolean {
  if (key.revokedAt !== null && key.revokedAt <= now) {
    return false;
  }
  if (key.expiresAt !== null && key.expiresAt <= now) {
    return false;
  }
  return true;
}

export function hasScope(key: StoredKey, scope: string): boolean {
  return key.scopes.includes(scope) || key.scopes.includes("*");
}

export function isInRotationGrace(oldKey: StoredKey, now: number): boolean {
  if (oldKey.revokedAt === null) {
    return true;
  }
  return now - oldKey.revokedAt < ROTATION_GRACE_MS;
}
