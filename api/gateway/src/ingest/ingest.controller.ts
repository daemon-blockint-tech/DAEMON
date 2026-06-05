import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { IngestService, type IngestRecord } from "./ingest.service";
import { IngestPipelineService } from "./ingest-pipeline.service";
import { IngestWebhookService } from "./ingest-webhook.service";
import { IngestListenerService } from "./ingest-listener.service";
import { Protected } from "../auth/protected.decorator";
import { PolicyCheck } from "../auth/policy-check.decorator";
import { TenantContextService } from "../platform/tenant-context";

interface StartJobBody {
  sourceId: string;
}

interface IngestRecordsBody {
  sourceId?: string;
  records?: IngestRecord[];
  ontologyId?: string;
  entityId?: string;
  entityType?: string;
  properties?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function normalizeIngestRecords(body: IngestRecordsBody): IngestRecord[] {
  if (body.records?.length) {
    return body.records;
  }
  if (body.ontologyId) {
    return [
      {
        ontologyId: body.ontologyId,
        entityId: body.entityId,
        entityType: body.entityType,
        properties: body.properties ?? body.payload ?? {},
      },
    ];
  }
  return [];
}

@Controller("v1/ingest")
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly pipeline: IngestPipelineService,
    private readonly webhooks: IngestWebhookService,
    private readonly listeners: IngestListenerService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("jobs")
  @Protected()
  listJobs() {
    return this.ingest.listJobs();
  }

  @Post("jobs")
  @Protected()
  @PolicyCheck("ingest", "ingest-job")
  startJob(@Body() body: StartJobBody) {
    return this.ingest.startJob(body.sourceId);
  }

  @Get("jobs/:id")
  getJob(@Param("id") id: string) {
    return this.ingest.getJob(id);
  }

  @Post("sources/:sourceId/run")
  @Protected()
  @PolicyCheck("ingest", "ingest-source")
  runSource(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("sourceId") sourceId: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.pipeline.runSource(ctx, sourceId);
  }

  @Post("records")
  @Protected()
  @PolicyCheck("ingest", "ingest-record")
  ingestRecords(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: IngestRecordsBody,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    const records = normalizeIngestRecords(body);
    return this.ingest.ingestRecords(ctx, body.sourceId ?? "gateway", records);
  }

  @Post("webhooks/:sourceId")
  @PolicyCheck("ingest", "ingest-webhook")
  webhookIngest(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("sourceId") sourceId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const raw =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(body ?? {});
    const sig = headers["x-daemon-signature"];
    this.webhooks.verifySignature(
      raw,
      typeof sig === "string" ? sig : Array.isArray(sig) ? sig[0] : undefined,
    );
    const ctx = this.tenantContext.resolve(headers);
    const records = this.webhooks.normalizePayload(body);
    return this.webhooks.ingest(ctx, sourceId, records);
  }

  @Post("listeners/:listenerId/events")
  @PolicyCheck("ingest", "ingest-listener")
  listenerIngest(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("listenerId") listenerId: string,
    @Body() body: unknown,
  ) {
    const idem = headers["x-idempotency-key"];
    const key =
      typeof idem === "string"
        ? idem
        : Array.isArray(idem)
          ? idem[0]
          : undefined;
    this.listeners.assertIdempotency(listenerId, key);
    const ctx = this.tenantContext.resolve(headers);
    const records = this.listeners.normalizeBatch(body);
    return this.listeners.ingest(ctx, listenerId, records);
  }

  @Post("agents/heartbeat")
  agentHeartbeat(
    @Body()
    body: {
      agentId?: string;
      sourceId?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return {
      ok: true,
      agentId: body.agentId ?? "unknown",
      sourceId: body.sourceId,
      status: body.status ?? "online",
      receivedAt: new Date().toISOString(),
    };
  }
}
