import { describe, expect, test } from "bun:test";
import {
  generateKey,
  hasScope,
  isInRotationGrace,
  isKeyActive,
  parseKey,
  verifySecret,
  verifyWithPepperRotation,
  type StoredKey,
} from "@infergate/auth";

const PEPPER = "test-pepper-1";
const PEPPER_V2 = "test-pepper-2";

function storedFixture(): StoredKey {
  const g = generateKey("org_1", ["chat:write", "models:read"], PEPPER, 1);
  return { id: "key_1", createdAt: Date.now(), ...g.record };
}

describe("auth", () => {
  test("generated key verifies", () => {
    const g = generateKey("org_1", ["chat:write"], PEPPER, 1);
    expect(g.publicKey.startsWith("ig_sk_")).toBe(true);
    expect(verifySecret(g.secret, { salt: g.salt, hashedSecret: g.hashedSecret }, PEPPER)).toBe(true);
    expect(verifySecret("wrong" + g.secret, { salt: g.salt, hashedSecret: g.hashedSecret }, PEPPER)).toBe(false);
  });

  test("wrong pepper fails", () => {
    const g = generateKey("org_1", ["chat:write"], PEPPER, 1);
    expect(verifySecret(g.secret, { salt: g.salt, hashedSecret: g.hashedSecret }, PEPPER_V2)).toBe(false);
  });

  test("pepper rotation accepts old and new", () => {
    const g = generateKey("org_1", ["chat:write"], PEPPER, 1);
    const stored: StoredKey = { id: "k", createdAt: Date.now(), ...g.record };
    const peppers = new Map([[1, PEPPER], [2, PEPPER_V2]]);
    expect(verifyWithPepperRotation(g.secret, stored, peppers)).toBe(true);
    expect(verifyWithPepperRotation("nope", stored, peppers)).toBe(false);
  });

  test("parseKey rejects malformed", () => {
    expect(parseKey("Bearer xyz")).toBeNull();
    expect(parseKey("ig_sk_short_x")).toBeNull();
    const g = generateKey("org_1", [], PEPPER, 1);
    expect(parseKey(g.publicKey)).not.toBeNull();
  });

  test("active checks respect revoke and expiry", () => {
    const now = Date.now();
    const k = storedFixture();
    expect(isKeyActive(k, now)).toBe(true);
    expect(isKeyActive({ ...k, revokedAt: now - 1 }, now)).toBe(false);
    expect(isKeyActive({ ...k, expiresAt: now - 1 }, now)).toBe(false);
    expect(hasScope(k, "chat:write")).toBe(true);
    expect(hasScope(k, "keys:write")).toBe(false);
    expect(hasScope({ ...k, scopes: ["*"] }, "anything")).toBe(true);
    expect(isInRotationGrace({ ...k, revokedAt: now }, now)).toBe(true);
    expect(isInRotationGrace({ ...k, revokedAt: now - 25 * 3600 * 1000 }, now)).toBe(false);
  });
});
