import { PgAudit } from "@infergate/db";

export interface AuditRecord {
  id: string;
  orgId: string;
  actorKeyId: string | null;
  action: string;
  target: string | null;
  createdAt: number;
}

export interface AuditLog {
  record(orgId: string, actorKeyId: string | null, action: string, target: string | null): Promise<void>;
  recent(orgId: string, limit: number): Promise<AuditRecord[]>;
}

export class NoopAudit implements AuditLog {
  async record(_orgId: string, _actor: string | null, _action: string, _target: string | null): Promise<void> {
    void _orgId;
    void _actor;
    void _action;
    void _target;
  }

  async recent(_orgId: string, _limit: number): Promise<AuditRecord[]> {
    void _orgId;
    void _limit;
    return [];
  }
}

export class DbAudit implements AuditLog {
  constructor(private pg: PgAudit) {}

  async record(orgId: string, actorKeyId: string | null, action: string, target: string | null): Promise<void> {
    await this.pg.record(orgId, actorKeyId, action, target);
  }

  async recent(orgId: string, limit: number): Promise<AuditRecord[]> {
    return this.pg.recent(orgId, limit);
  }
}
