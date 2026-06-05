import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ReadRouter } from "@daemon/read-write-loops/reads/read-router.js";
import { CommandGateway } from "@daemon/read-write-loops/writes/command-gateway.js";
import { defaultOntology } from "@daemon/ontology";
import {
  DaemonError,
  ErrorCodes,
  entityId,
  ontologyId,
} from "@daemon/platform-types";
import { AnalyticsWorkflows } from "@daemon/products/analytics-workflows/analytics-workflows.js";
import { AutomationsWorkflows } from "@daemon/products/automations/automations-workflows.js";
import { StructuredLogger } from "@daemon/observability/logging/structured-logger.js";
import {
  globalHttpMetrics,
  normalizeRoutePath,
} from "@daemon/observability/metrics/http-metrics.js";
import { resolveSession } from "./session.js";
import { openApiDocument } from "./openapi.js";
import { OntologyGovernance } from "@daemon/ontology/governance/ontology-governance.js";
import type { SchemaChangeDescriptor } from "@daemon/ontology/governance/governance-policy-loader.js";
import { diffPackChange } from "@daemon/ontology/packs/pack-diff.js";

interface WriteBody {
  entityId: string;
  ontologyId?: string;
  patch: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Builds the REST HTTP server. It reuses the same {@link ReadRouter} and
 * {@link CommandGateway} the gateway uses, so the standalone REST app and the
 * Nest gateway share one source of truth for read/write semantics.
 *
 * The returned server is not started; callers invoke `.listen()`. This keeps
 * the factory testable with an ephemeral port.
 */
const restLogger = new StructuredLogger({ service: "daemon-api-rest" });

export function createRestServer(): Server {
  const reads = new ReadRouter();
  const writes = new CommandGateway();
  const analytics = new AnalyticsWorkflows();
  const automations = new AutomationsWorkflows();

  return createServer((req, res) => {
    const started = performance.now();
    const route = normalizeRoutePath(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
    res.on("finish", () => {
      const durationMs = Math.round(performance.now() - started);
      globalHttpMetrics.recordRequest(
        { method: req.method ?? "GET", route, status: String(res.statusCode) },
        durationMs,
      );
      restLogger.info("http_request", {
        method: req.method,
        route,
        status: res.statusCode,
        durationMs,
      });
    });
    handle(req, res, reads, writes, analytics, automations).catch((err) => {
      sendError(res, err);
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  reads: ReadRouter,
  writes: CommandGateway,
  analytics: AnalyticsWorkflows,
  automations: AutomationsWorkflows,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (method === "GET" && path === "/openapi.json") {
    return sendJson(res, 200, openApiDocument);
  }

  if (method === "GET" && path === "/metrics") {
    const body = globalHttpMetrics.prometheusText();
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(body);
    return;
  }

  if (method === "GET" && path === "/v1/analytics/search") {
    const q = url.searchParams.get("q") ?? "";
    const ont = ontologyId(url.searchParams.get("ontologyId") ?? defaultOntology());
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const report = await analytics.searchAndReport({
      query: q,
      ontologyId: ont,
      limit: Number.isFinite(limit) ? limit : undefined,
      property: url.searchParams.get("property") ?? undefined,
      propertyValue: url.searchParams.get("propertyValue") ?? undefined,
      reportTitle: url.searchParams.get("reportTitle") ?? undefined,
    });
    return sendJson(res, 200, report);
  }

  if (method === "GET" && path === "/v1/analytics/entities") {
    const q = url.searchParams.get("q") ?? "";
    const ont = ontologyId(url.searchParams.get("ontologyId") ?? defaultOntology());
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const entities = await analytics.search({
      query: q,
      ontologyId: ont,
      limit: Number.isFinite(limit) ? limit : undefined,
      property: url.searchParams.get("property") ?? undefined,
      propertyValue: url.searchParams.get("propertyValue") ?? undefined,
    });
    return sendJson(res, 200, entities);
  }

  if (method === "GET" && path === "/v1/analytics/dashboard") {
    const ont = ontologyId(url.searchParams.get("ontologyId") ?? defaultOntology());
    const breakdownField = url.searchParams.get("breakdownField") ?? undefined;
    const dashboard = analytics.buildDashboard(ont, { breakdownField });
    return sendJson(res, 200, dashboard);
  }

  const entityMatch = path.match(/^\/v1\/entities\/([^/]+)$/);
  if (method === "GET" && entityMatch) {
    const id = decodeURIComponent(entityMatch[1]);
    const ont = url.searchParams.get("ontologyId") ?? defaultOntology();
    try {
      const record = reads.route({
        ontologyId: ontologyId(ont),
        entityId: entityId(id),
      });
      return sendJson(res, 200, record);
    } catch {
      throw new DaemonError(
        ErrorCodes.NOT_FOUND,
        `entity not found: ${ont}/${id}`,
        404,
      );
    }
  }

  if (method === "POST" && path === "/v1/governance/pack/validate-change") {
    const body = await readJson<
      SchemaChangeDescriptor & {
        proposedPackDir?: string;
        proposedOverrides?: {
          entities?: Record<
            string,
            { fields: { name: string; type: string; required?: boolean }[] }
          >;
        };
      }
    >(req);
    if (!body?.packId) {
      throw new DaemonError(ErrorCodes.VALIDATION, "packId is required", 400);
    }
    const governance = OntologyGovernance.load();
    let diff;
    if (body.proposedPackDir || body.proposedOverrides) {
      diff = diffPackChange({
        packId: body.packId,
        proposedPackDir: body.proposedPackDir,
        proposedOverrides: body.proposedOverrides,
      });
    } else if (!body.changeType || body.breaking === undefined) {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        "proposedPackDir, proposedOverrides, or legacy changeType+breaking required",
        400,
      );
    }
    const gate = governance.assertSchemaChange({ ...body, diff });
    return sendJson(res, 200, {
      allowed: gate.allowed,
      reason: gate.reason,
      obligations: gate.obligations,
      auditAction: gate.auditAction,
      diff: gate.diff,
    });
  }

  if (method === "POST" && path === "/v1/automations/run") {
    const session = resolveSession(req.headers);
    const body = await readJson<{
      steps: { id: string; action: string }[];
      loop?: WriteBody;
    }>(req);
    if (!body || !Array.isArray(body.steps)) {
      throw new DaemonError(ErrorCodes.VALIDATION, "steps array is required", 400);
    }
    const loop = body.loop
      ? {
          ontologyId: ontologyId(body.loop.ontologyId ?? defaultOntology()),
          entityId: entityId(body.loop.entityId),
          patch: body.loop.patch,
          idempotencyKey: body.loop.idempotencyKey,
        }
      : undefined;
    const result = await automations.run(session, body.steps, loop);
    return sendJson(res, 200, result);
  }

  if (method === "POST" && path === "/v1/automations/evaluate") {
    const body = await readJson<{ patch: Record<string, unknown>; approvals: string[] }>(req);
    if (!body || typeof body.patch !== "object") {
      throw new DaemonError(ErrorCodes.VALIDATION, "patch object is required", 400);
    }
    const decision = automations.evaluateApproval(body.patch, body.approvals ?? []);
    return sendJson(res, 200, decision);
  }

  if (method === "POST" && path === "/v1/automations/approve") {
    const session = resolveSession(req.headers);
    const body = await readJson<{
      loop: WriteBody;
      approvals: string[];
    }>(req);
    if (!body?.loop || typeof body.loop.entityId !== "string" || typeof body.loop.patch !== "object") {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        "loop with entityId and patch is required",
        400,
      );
    }
    const outcome = automations.approve(
      session,
      {
        ontologyId: ontologyId(body.loop.ontologyId ?? defaultOntology()),
        entityId: entityId(body.loop.entityId),
        patch: body.loop.patch,
        idempotencyKey: body.loop.idempotencyKey,
      },
      body.approvals ?? [],
    );
    return sendJson(res, 200, outcome);
  }

  if (method === "POST" && path === "/v1/write") {
    const session = resolveSession(req.headers);
    const body = await readJson<WriteBody>(req);
    if (!body || typeof body.entityId !== "string" || typeof body.patch !== "object") {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        "entityId and patch are required",
        400,
      );
    }
    try {
      const result = writes.submit({
        session,
        ontologyId: ontologyId(body.ontologyId ?? defaultOntology()),
        entityId: entityId(body.entityId),
        patch: body.patch,
        idempotencyKey: body.idempotencyKey,
      });
      return sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DaemonError(ErrorCodes.NOT_FOUND, message, 404);
    }
  }

  throw new DaemonError(ErrorCodes.NOT_FOUND, `no route for ${method} ${path}`, 404);
}

function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new DaemonError(ErrorCodes.VALIDATION, "invalid JSON body", 400));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof DaemonError) {
    return sendJson(res, err.status, { code: err.code, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { code: ErrorCodes.INTERNAL, message });
}
