import { Injectable } from "@nestjs/common";
import { DaemonError, ErrorCodes, entityId, ontologyId } from "@daemon/platform-types";
import { DaemonRuntime } from "../platform/daemon-runtime";
import type { TenantContextHeaders } from "../platform/tenant-context";

export interface JobResult {
  jobId: string;
  status: string;
  sourceId?: string;
  startedAt?: string;
}

export interface IngestResult extends JobResult {
  accepted?: number;
}

export interface IngestRecord {
  ontologyId: string;
  entityId?: string;
  entityType?: string;
  properties: Record<string, unknown>;
}

@Injectable()
export class IngestService {
  private readonly baseUrl: string;
  private readonly skipUpstream: boolean;

  constructor(
    private readonly runtime: DaemonRuntime,
    env: NodeJS.ProcessEnv,
  ) {
    this.baseUrl = (env.DAEMON_INGEST_URL ?? "http://127.0.0.1:8081").replace(/\/+$/, "");
    this.skipUpstream =
      env.DAEMON_INGEST_SKIP_UPSTREAM === "1" ||
      env.DAEMON_INGEST_SKIP_UPSTREAM === "true";
  }

  static create(
    runtime: DaemonRuntime,
    env: NodeJS.ProcessEnv = process.env,
  ): IngestService {
    return new IngestService(runtime, env);
  }

  async startJob(sourceId: string): Promise<JobResult> {
    return this.post<JobResult>("/v1/jobs", { sourceId });
  }

  async listJobs(): Promise<{ items: JobResult[] }> {
    const url = process.env.DAEMON_POSTGRES_URL;
    if (!url) {
      return { items: [] };
    }
    const { PostgresClient } = await import(
      "@daemon/data-platform/operational-store"
    );
    const client = new PostgresClient({ connectionString: url });
    try {
      const { rows } = await client.query<{
        id: string;
        source_id: string;
        last_status: string | null;
        last_run_at: string | null;
      }>(
        `SELECT id, source_id, last_status, last_run_at
         FROM daemon_ingest_schedules
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 100`,
      );
      return {
        items: rows.map((r) => ({
          jobId: r.id,
          status: r.last_status ?? "scheduled",
          sourceId: r.source_id,
          startedAt: r.last_run_at ?? undefined,
        })),
      };
    } finally {
      await client.close();
    }
  }

  async getJob(jobId: string): Promise<JobResult> {
    const res = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`);
    if (res.status === 404) {
      throw new DaemonError(ErrorCodes.NOT_FOUND, `ingest job ${jobId} not found`, 404);
    }
    if (!res.ok) {
      throw new DaemonError(ErrorCodes.UPSTREAM, await safeText(res), 502);
    }
    return (await res.json()) as JobResult;
  }

  async ingestRecords(
    ctx: TenantContextHeaders,
    sourceId: string,
    records: IngestRecord[],
  ): Promise<IngestResult> {
    if (records.length === 0) {
      throw new DaemonError(ErrorCodes.VALIDATION, "records must not be empty", 400);
    }
    return this.persistIngestRecords(ctx, sourceId, records);
  }

  /**
   * Validates, upserts ontology entities, flushes durable writes, optionally forwards to Go.
   */
  async persistIngestRecords(
    ctx: TenantContextHeaders,
    sourceId: string,
    records: IngestRecord[],
  ): Promise<IngestResult> {
    await this.registerOntologyRecords(ctx, records);
    if (this.skipUpstream) {
      return localIngestResult(sourceId, records.length);
    }
    try {
      return await this.post<IngestResult>("/ingest/records", { sourceId, records });
    } catch (error) {
      if (
        error instanceof DaemonError &&
        error.code === ErrorCodes.UPSTREAM
      ) {
        return localIngestResult(sourceId, records.length, "accepted-local");
      }
      throw error;
    }
  }

  private async registerOntologyRecords(
    ctx: TenantContextHeaders,
    records: IngestRecord[],
  ): Promise<void> {
    const scope = { tenantId: ctx.tenantId, domainId: ctx.domainId };
    const tenant = this.runtime.tenants.require(ctx.tenantId);
    const pack = this.runtime.packs.resolve(tenant, ctx.domainId);
    let seq = 0;
    for (const record of records) {
      if (!record.ontologyId) continue;
      seq += 1;
      const ent =
        record.entityId ?? `${record.ontologyId}-ingest-${Date.now()}-${seq}`;
      const entityType =
        record.entityType ??
        (typeof record.properties.entityType === "string"
          ? record.properties.entityType
          : undefined);
      this.runtime.upsertEntity(
        scope,
        {
          scope,
          ontologyId: ontologyId(record.ontologyId),
          properties: record.properties ?? {},
          entityId: entityId(ent),
          entityType,
        },
        pack,
      );
    }
    await this.runtime.flushDurableWrites();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new DaemonError(
        ErrorCodes.UPSTREAM,
        `ingest service unreachable: ${(error as Error).message}`,
        502,
      );
    }
    if (!res.ok) {
      throw new DaemonError(ErrorCodes.UPSTREAM, await safeText(res), 502);
    }
    return (await res.json()) as T;
  }
}

function localIngestResult(
  sourceId: string,
  accepted: number,
  status = "accepted",
): IngestResult {
  return {
    jobId: `local-${sourceId}-${Date.now()}`,
    status,
    sourceId,
    accepted,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text || `ingest service responded ${res.status}`;
  } catch {
    return `ingest service responded ${res.status}`;
  }
}
