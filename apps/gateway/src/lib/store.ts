import type { StoredKey } from "@infergate/auth";

export interface UsageRecord {
  id: string;
  idempotencyKey: string | null;
  orgId: string;
  keyId: string | null;
  providerId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  status: string;
  error: string | null;
  createdAt: number;
}

export interface KeyStore {
  findByPrefix(prefix: string): Promise<StoredKey | null>;
  findById(id: string): Promise<StoredKey | null>;
  save(key: StoredKey): Promise<void>;
  revoke(id: string, now: number): Promise<void>;
}

export interface UsageStore {
  insert(record: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord>;
  findByIdempotencyKey(key: string): Promise<UsageRecord | null>;
  usageByOrg(orgId: string): Promise<{ requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export class MemoryKeyStore implements KeyStore {
  private byId = new Map<string, StoredKey>();
  private byPrefix = new Map<string, StoredKey>();

  async findByPrefix(prefix: string): Promise<StoredKey | null> {
    return this.byPrefix.get(prefix) ?? null;
  }

  async findById(id: string): Promise<StoredKey | null> {
    return this.byId.get(id) ?? null;
  }

  async save(key: StoredKey): Promise<void> {
    this.byId.set(key.id, key);
    this.byPrefix.set(key.prefix, key);
  }

  async revoke(id: string, now: number): Promise<void> {
    const key = this.byId.get(id);
    if (key) {
      key.revokedAt = now;
    }
  }
}

export class MemoryUsageStore implements UsageStore {
  private records: UsageRecord[] = [];

  async insert(record: Omit<UsageRecord, "id" | "createdAt">): Promise<UsageRecord> {
    const row: UsageRecord = { ...record, id: crypto.randomUUID(), createdAt: Date.now() };
    this.records.push(row);
    return row;
  }

  async findByIdempotencyKey(key: string): Promise<UsageRecord | null> {
    return this.records.find((r) => r.idempotencyKey === key) ?? null;
  }

  async usageByOrg(orgId: string): Promise<{ requests: number; inputTokens: number; outputTokens: number; costUsd: number }> {
    const rows = this.records.filter((r) => r.orgId === orgId && r.status === "ok");
    return {
      requests: rows.length,
      inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
      costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    };
  }
}
