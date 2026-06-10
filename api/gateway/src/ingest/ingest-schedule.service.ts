import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TenantContextHeaders } from "../platform/tenant-context";
import { IngestPipelineService } from "./ingest-pipeline.service";

export interface IngestScheduleRow {
  id: string;
  tenantId: string;
  domainId: string;
  sourceId: string;
  cronExpr: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
}

interface CreateScheduleInput {
  sourceId: string;
  cronExpr: string;
  enabled?: boolean;
}

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function resolveValue(v: string): number {
  const upper = v.trim().toUpperCase();
  if (upper in DAY_NAMES) return DAY_NAMES[upper]!;
  return Number(v.trim());
}

/**
 * 5-field cron parser: minute hour dom month dow
 * Supports: *, *\/step, ranges (1-5), comma lists, and named weekdays (MON-SUN).
 */
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const fields = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
  ];
  for (let i = 0; i < 5; i++) {
    const spec = parts[i]!;
    if (spec === "*") continue;
    if (spec.startsWith("*/")) {
      const step = Number(spec.slice(2));
      if (!Number.isFinite(step) || step <= 0) return false;
      if (fields[i]! % step !== 0) return false;
      continue;
    }
    // Expand comma-separated list, each item may be a range (1-5) or a value
    const matched = spec.split(",").some((item) => {
      const rangeParts = item.split("-");
      if (rangeParts.length === 2) {
        const lo = resolveValue(rangeParts[0]!);
        const hi = resolveValue(rangeParts[1]!);
        return fields[i]! >= lo && fields[i]! <= hi;
      }
      return resolveValue(item) === fields[i]!;
    });
    if (!matched) return false;
  }
  return true;
}

@Injectable()
export class IngestScheduleService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  // Map<scheduleId, minuteKey> — evicted each tick to prevent unbounded growth
  private readonly lastMinute = new Map<string, string>();
  private pg: import("@daemon/data-platform/operational-store").PostgresClient | undefined;

  constructor(private readonly pipeline: IngestPipelineService) {}

  async onModuleInit(): Promise<void> {
    if (!process.env.DAEMON_POSTGRES_URL) return;
    const { PostgresClient } = await import("@daemon/data-platform/operational-store");
    this.pg = new PostgresClient({ connectionString: process.env.DAEMON_POSTGRES_URL });
    const pollSec = Number(process.env.DAEMON_INGEST_SCHEDULE_POLL_SECONDS ?? "60");
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        console.error("[ingest-scheduler]", err);
      });
    }, Math.max(15, pollSec) * 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pg?.close();
  }

  private getDb() {
    if (!this.pg) throw new Error("Postgres client not initialised (DAEMON_POSTGRES_URL missing?)");
    return this.pg;
  }

  async list(ctx: TenantContextHeaders): Promise<IngestScheduleRow[]> {
    const res = await this.getDb().query<{
      id: string;
      tenant_id: string;
      domain_id: string;
      source_id: string;
      cron_expr: string;
      enabled: boolean;
      last_run_at: Date | null;
      last_status: string | null;
      last_error: string | null;
    }>(
      `SELECT id, tenant_id, domain_id, source_id, cron_expr, enabled,
              last_run_at, last_status, last_error
       FROM daemon_ingest_schedules
       WHERE tenant_id = $1 AND domain_id = $2
       ORDER BY created_at DESC`,
      [ctx.tenantId, ctx.domainId],
    );
    return res.rows.map(rowToSchedule);
  }

  async create(
    ctx: TenantContextHeaders,
    input: CreateScheduleInput,
  ): Promise<IngestScheduleRow> {
    const id = `sched-${randomUUID()}`;
    await this.getDb().query(
      `INSERT INTO daemon_ingest_schedules
       (id, tenant_id, domain_id, source_id, cron_expr, enabled)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        ctx.tenantId,
        ctx.domainId,
        input.sourceId,
        input.cronExpr,
        input.enabled !== false,
      ],
    );
    return {
      id,
      tenantId: ctx.tenantId,
      domainId: ctx.domainId,
      sourceId: input.sourceId,
      cronExpr: input.cronExpr,
      enabled: input.enabled !== false,
    };
  }

  async patch(
    ctx: TenantContextHeaders,
    id: string,
    patch: Partial<Pick<CreateScheduleInput, "cronExpr" | "enabled" | "sourceId">>,
  ): Promise<IngestScheduleRow> {
    const db = this.getDb();
    const existing = await db.query<{ cron_expr: string; enabled: boolean; source_id: string }>(
      `SELECT cron_expr, enabled, source_id FROM daemon_ingest_schedules
       WHERE id = $1 AND tenant_id = $2 AND domain_id = $3`,
      [id, ctx.tenantId, ctx.domainId],
    );
    if (!existing.rows[0]) {
      throw new Error(`schedule not found: ${id}`);
    }
    const row = existing.rows[0];
    await db.query(
      `UPDATE daemon_ingest_schedules SET
         cron_expr = $4, enabled = $5, source_id = $6, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND domain_id = $3
       RETURNING id, tenant_id, domain_id, source_id, cron_expr, enabled,
                 last_run_at, last_status, last_error`,
      [
        id,
        ctx.tenantId,
        ctx.domainId,
        patch.cronExpr ?? row.cron_expr,
        patch.enabled ?? row.enabled,
        patch.sourceId ?? row.source_id,
      ],
    );
    // Re-fetch the patched row directly instead of full list()
    const updated = await db.query<{
      id: string;
      tenant_id: string;
      domain_id: string;
      source_id: string;
      cron_expr: string;
      enabled: boolean;
      last_run_at: Date | null;
      last_status: string | null;
      last_error: string | null;
    }>(
      `SELECT id, tenant_id, domain_id, source_id, cron_expr, enabled,
              last_run_at, last_status, last_error
       FROM daemon_ingest_schedules
       WHERE id = $1`,
      [id],
    );
    if (!updated.rows[0]) throw new Error(`schedule not found after patch: ${id}`);
    return rowToSchedule(updated.rows[0]);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16);

    // Evict stale lastMinute entries to prevent unbounded Map growth
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString().slice(0, 16);
    for (const [sid, min] of this.lastMinute) {
      if (min < cutoff) this.lastMinute.delete(sid);
    }

    const db = this.getDb();
    const res = await db.query<{
      id: string;
      tenant_id: string;
      domain_id: string;
      source_id: string;
      cron_expr: string;
    }>(
      `SELECT id, tenant_id, domain_id, source_id, cron_expr
       FROM daemon_ingest_schedules WHERE enabled = true`,
    );
    for (const row of res.rows) {
      if (!cronMatches(row.cron_expr, now)) continue;
      if (this.lastMinute.get(row.id) === minuteKey) continue;
      this.lastMinute.set(row.id, minuteKey);
      const ctx: TenantContextHeaders = {
        tenantId: row.tenant_id,
        domainId: row.domain_id,
      };
      try {
        await this.pipeline.runSource(ctx, row.source_id);
        await db.query(
          `UPDATE daemon_ingest_schedules SET last_run_at = NOW(), last_status = 'ok', last_error = NULL, updated_at = NOW() WHERE id = $1`,
          [row.id],
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.query(
          `UPDATE daemon_ingest_schedules SET last_run_at = NOW(), last_status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`,
          [row.id, message],
        );
      }
    }
  }
}

function rowToSchedule(row: {
  id: string;
  tenant_id: string;
  domain_id: string;
  source_id: string;
  cron_expr: string;
  enabled: boolean;
  last_run_at: Date | null;
  last_status: string | null;
  last_error: string | null;
}): IngestScheduleRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domainId: row.domain_id,
    sourceId: row.source_id,
    cronExpr: row.cron_expr,
    enabled: row.enabled,
    lastRunAt: row.last_run_at?.toISOString(),
    lastStatus: row.last_status ?? undefined,
    lastError: row.last_error ?? undefined,
  };
}
