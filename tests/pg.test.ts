import { describe, expect, test } from "bun:test";
import { generateKey } from "@infergate/auth";
import { createSql, PgAudit, PgKeyStore, PgPlanStore, PgRuleStore, PgUsageStore, PgWebhookStore } from "@infergate/db";

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "";
const describePg = DATABASE_URL === "" ? describe.skip : describe;

describePg("postgres stores", () => {
  const sql = DATABASE_URL === "" ? null : createSql({ connectionString: DATABASE_URL, maxConnections: 5, statementTimeoutMs: 5000 });

  test("key crud with rotation grace", async () => {
    const keys = new PgKeyStore(sql!);
    const orgId = crypto.randomUUID();
    await sql!`INSERT INTO organizations (id, name) VALUES (${orgId}, 'pg org')`;
    const g = generateKey(orgId, ["chat:write"], "pg-pepper-0123456789", 1);
    const id = crypto.randomUUID();
    await keys.save({ id, createdAt: Date.now(), ...g.record });
    const found = await keys.findByPrefix(g.prefix);
    expect(found?.id).toBe(id);
    expect(found?.orgId).toBe(orgId);
    await keys.scheduleRevoke(id, Date.now() + 3600000);
    const graced = await keys.findById(id);
    expect((graced?.revokedAt ?? 0)).toBeGreaterThan(Date.now());
    await keys.revoke(id, Date.now());
    const revoked = await keys.findById(id);
    expect((revoked?.revokedAt ?? 0)).toBeLessThanOrEqual(Date.now());
  });

  test("usage insert replays idempotency atomically", async () => {
    const usage = new PgUsageStore(sql!);
    const orgId = crypto.randomUUID();
    await sql!`INSERT INTO organizations (id, name) VALUES (${orgId}, 'pg usage')`;
    const row = {
      idempotencyKey: "pg-idem-1",
      orgId,
      keyId: null,
      providerId: "openai",
      model: "gpt-4o-mini",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 12,
      costUsd: 0.001,
      status: "ok",
      error: null,
    };
    const first = await usage.insert(row);
    const second = await usage.insert(row);
    expect(second.id).toBe(first.id);
    const found = await usage.findByIdempotencyKey(orgId, "pg-idem-1");
    expect(found?.id).toBe(first.id);
    const summary = await usage.usageByOrg(orgId);
    expect(summary.requests).toBe(1);
    const period = await usage.periodUsage(orgId, 0);
    expect(period.tokens).toBe(15);
    const recent = await usage.recent(orgId, 10);
    expect(recent.length).toBe(1);
    expect(await usage.ping()).toBe(true);
  });

  test("routing rules persist per org", async () => {
    const rules = new PgRuleStore(sql!);
    const orgId = crypto.randomUUID();
    await sql!`INSERT INTO organizations (id, name) VALUES (${orgId}, 'pg rules')`;
    const created = await rules.create({
      orgId,
      modelAlias: "auto",
      strategy: "cost",
      weights: {},
      priority: [],
      maxAttempts: 2,
    });
    expect(created.id).toBeString();
    const listed = await rules.list(orgId);
    expect(listed.length).toBe(1);
    expect(listed[0].strategy).toBe("cost");
    expect(await rules.remove(orgId, created.id)).toBe(true);
    expect(await rules.remove(orgId, created.id)).toBe(false);
  });

  test("plans and webhooks persist", async () => {
    const plans = new PgPlanStore(sql!);
    const hooks = new PgWebhookStore(sql!);
    const orgId = crypto.randomUUID();
    expect(await plans.get(orgId)).toBe("free");
    await plans.set(orgId, "pro");
    expect(await plans.get(orgId)).toBe("pro");
    const hook = await hooks.add(orgId, "https://example.com/hook", "secret-0123456789abcdef", ["provider.outage"]);
    expect(hook.id).toBeString();
    expect((await hooks.list(orgId)).length).toBe(1);
    expect(await hooks.remove(orgId, hook.id)).toBe(true);
    expect((await hooks.list(orgId)).length).toBe(0);
  });

  test("audit log records and lists", async () => {
    const audit = new PgAudit(sql!);
    const orgId = crypto.randomUUID();
    await sql!`INSERT INTO organizations (id, name) VALUES (${orgId}, 'pg audit')`;
    await audit.record(orgId, null, "key.create", "key-1");
    await audit.record(orgId, null, "org.plan", "pro");
    const entries = await audit.recent(orgId, 10);
    expect(entries.length).toBe(2);
    expect(entries[0].action).toBe("org.plan");
  });
});
