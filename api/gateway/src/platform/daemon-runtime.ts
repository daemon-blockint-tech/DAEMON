import type { PolicyDecision } from "@daemon/platform-types";
import { DaemonError, ErrorCodes } from "@daemon/platform-types";
import type {
  OntologyStore,
  AuditPort,
  OntologyScope,
  RegisterEntityInput,
  EntityRecord,
} from "@daemon/context-ports";
import { globalRegistry } from "@daemon/ontology";
import { createOntologyStoreFromEnv } from "@daemon/ontology/store/create-ontology-store.js";
import { resolveOntologyRegistry } from "@daemon/ontology/store/resolve-registry.js";
import { DurableOntologyStore } from "@daemon/ontology/store/durable-ontology-store.js";
import { ReadRouter } from "@daemon/read-write-loops/reads/read-router.js";
import { CommandGateway } from "@daemon/read-write-loops/writes/command-gateway.js";
import { evaluateWriteWithLogicEngine } from "@daemon/read-write-loops/writes/logic-engine-client.js";
import { LoopOrchestrator } from "@daemon/read-write-loops/loop-controller/loop-orchestrator.js";
import {
  PolicyEngine,
  type PolicyRule,
} from "@daemon/security-governance/policy-engine.js";
import { AuditPortAdapter } from "@daemon/security-governance/audit/audit-port-adapter.js";
import { PackResolver } from "@daemon/ontology/packs/pack-resolver.js";
import { TenantRegistry } from "@daemon/ontology/tenancy/tenant-registry.js";
import { DomainCatalog } from "@daemon/ontology/tenancy/domain-catalog.js";
import { OntologyGovernance } from "@daemon/ontology/governance/ontology-governance.js";
import { PropagationExecutor } from "@daemon/ontology/governance/propagation-executor.js";
import { loadFoundationPack } from "@daemon/ontology/packs/load-pack.js";
import { EntityReadModelProjection } from "@daemon/ontology/projections/read-models/entity-read-model.js";
import { MaterializedView } from "@daemon/ontology/projections/materialized-views/materialized-view.js";
import { GraphEdgeSyncPort } from "@daemon/ontology/governance/propagation-graph-sync.js";
import { Neo4jGraphSync } from "@daemon/ontology/graph-sync/neo4j-graph-sync.js";
import { buildPackGraphSchema } from "@daemon/ontology/graph-schema/pack-graph-schema.js";
import { Neo4jGraphStore } from "@daemon/data-platform/graph-store/neo4j-graph-store";
import type { ResolvedPack } from "@daemon/ontology/packs/pack-resolver.js";
import { StructuredLogger } from "@daemon/observability/logging/structured-logger.js";
import {
  loadActionCatalog,
  loadActionCatalogPolicyRules,
  onCommittedStepsFor,
  toWorkflowSteps,
  type ActionCatalogManifest,
} from "@daemon/ontology/governance/action-catalog-loader.js";
import {
  WorkflowOrchestrator,
  type WorkflowStep,
} from "@daemon/action-runtime/workflow-engine/workflow-orchestrator.js";
import { ScopedOntologySearch } from "@daemon/ontology/search/scoped-ontology-search.js";
import { BronzeWriter } from "@daemon/data-platform/lakehouse/bronze-writer";
import { BronzeReader } from "@daemon/data-platform/lakehouse/bronze-reader";
import { SilverWriter } from "@daemon/data-platform/lakehouse/silver-writer";
import { LakehouseReader } from "@daemon/data-platform/lakehouse/lakehouse-reader";

/** Test fallback when action-catalog.yaml is missing. */
export const DEFAULT_GATEWAY_POLICY_RULES: PolicyRule[] = [
  { action: "read", resource: "entity", effect: "allow" },
  { action: "write", resource: "entity", effect: "allow" },
  { action: "ingest", resource: "ingest-record", effect: "allow" },
  { action: "ingest", resource: "ingest-job", effect: "allow" },
  { action: "ingest", resource: "ingest-source", effect: "allow" },
  { action: "query", resource: "ontology-nl", effect: "allow" },
  { action: "query", resource: "ontology-search", effect: "allow" },
  { action: "query", resource: "analytics", effect: "allow" },
  { action: "read", resource: "lakehouse", effect: "allow" },
  { action: "chat", resource: "customer-gpt", effect: "allow" },
  { action: "read", resource: "agent-session", effect: "allow" },
  { action: "read", resource: "function-invoke", effect: "allow" },
  { action: "ingest", resource: "ingest-schedule", effect: "allow" },
  { action: "ingest", resource: "ingest-webhook", effect: "allow" },
  { action: "read", resource: "data-health", effect: "allow" },
  { action: "write", resource: "lakehouse-export", effect: "allow" },
  { action: "read", resource: "media", effect: "allow" },
  { action: "write", resource: "media", effect: "allow" },
  { action: "read", resource: "ontology-pack", effect: "allow" },
  { action: "write", resource: "pipeline", effect: "allow" },
  { action: "write", resource: "eval", effect: "allow" },
  { action: "read", resource: "eval", effect: "allow" },
];

function resolveGatewayPolicyRules(): PolicyRule[] {
  try {
    return loadActionCatalogPolicyRules() as PolicyRule[];
  } catch {
    return DEFAULT_GATEWAY_POLICY_RULES;
  }
}

function resolveActionCatalog(): ActionCatalogManifest | undefined {
  try {
    return loadActionCatalog();
  } catch {
    return undefined;
  }
}

export interface DaemonRuntimeOptions {
  store?: OntologyStore;
  policy?: PolicyEngine;
  audit?: AuditPort;
}

/**
 * Composition root for the API gateway: scoped ontology store, loop, audit, packs.
 */
export class DaemonRuntime {
  readonly store: OntologyStore;
  readonly reads: ReadRouter;
  readonly writes: CommandGateway;
  readonly policy: PolicyEngine;
  readonly audit: AuditPort;
  readonly tenants: TenantRegistry;
  readonly domains: DomainCatalog;
  readonly packs: PackResolver;
  readonly governance: OntologyGovernance;
  readonly foundationPack = loadFoundationPack();
  readonly projection: EntityReadModelProjection;
  readonly materializedViews: Map<string, MaterializedView>;
  readonly propagation: PropagationExecutor;
  readonly search: ScopedOntologySearch;
  readonly lakehouseBronze: BronzeWriter;
  readonly lakehouseBronzeReader: BronzeReader;
  readonly lakehouseSilver: SilverWriter;
  readonly lakehouseReader: LakehouseReader;
  readonly actionCatalog: ActionCatalogManifest | undefined;
  readonly neo4jStore: Neo4jGraphStore | null;
  private readonly workflows = new WorkflowOrchestrator();

  constructor(options: DaemonRuntimeOptions = {}) {
    this.store = options.store ?? globalRegistry;
    this.projection = new EntityReadModelProjection();
    const readLogger = new StructuredLogger({ service: "daemon-read-parity" });
    this.reads = new ReadRouter(this.store, {
      projection: this.projection,
      useProjection: process.env.DAEMON_READ_FROM_PROJECTION === "1",
      parityCheck: process.env.DAEMON_READ_PARITY_CHECK === "1",
      onParityReport: (report) => {
        if (report.status === "match") return;
        readLogger.warn("read_parity_mismatch", {
          reason: report.reason,
          tenantId: report.tenantId,
          domainId: report.domainId,
          ontologyId: report.ontologyId,
          entityId: report.entityId,
          details: report.details,
        });
      },
    });
    this.writes = new CommandGateway(this.store);
    this.actionCatalog = resolveActionCatalog();
    this.policy =
      options.policy ?? PolicyEngine.fromRules(resolveGatewayPolicyRules());
    this.audit = options.audit ?? AuditPortAdapter.fromEnv();
    this.tenants = TenantRegistry.fromYamlFile();
    this.domains = DomainCatalog.fromYamlFile();
    this.packs = new PackResolver(this.domains);
    this.governance = OntologyGovernance.load();
    this.materializedViews = new Map([
      [
        "case-by-status",
        new MaterializedView("case-by-status", (p) =>
          String(p.status ?? "unknown"),
        ),
      ],
      [
        "party-by-kind",
        new MaterializedView("party-by-kind", (p) =>
          String(p.partyKind ?? "unknown"),
        ),
      ],
    ]);
    this.search = new ScopedOntologySearch();
    this.lakehouseBronze = BronzeWriter.fromEnv();
    this.lakehouseBronzeReader = BronzeReader.fromEnv();
    this.lakehouseSilver = SilverWriter.fromEnv();
    this.lakehouseReader = LakehouseReader.fromEnv();
    this.neo4jStore = Neo4jGraphStore.fromEnv();
    const neo4jGraphSync = this.neo4jStore
      ? new Neo4jGraphSync(this.neo4jStore)
      : undefined;
    this.propagation = new PropagationExecutor(this.governance.propagationRules(), {
      projection: this.projection,
      audit: this.audit,
      materializedViews: this.materializedViews,
      graphEdgeSync: new GraphEdgeSyncPort(this.audit),
      neo4jGraphSync,
      ontologySearch: this.search,
      lakehouseBronze: this.lakehouseBronze,
      lakehouseSilver: this.lakehouseSilver,
    });
    this.wireSemanticLayer();
  }

  private wireSemanticLayer(): void {
    const registry = resolveOntologyRegistry(this.store);
    if (!registry) return;
    this.projection.attach(registry);
    for (const view of this.materializedViews.values()) {
      view.attach(registry);
    }
    registry.subscribeEvents((event) => {
      const trigger = event.kind === "registered" ? "register" : "patch";
      const scope: OntologyScope = {
        tenantId: event.record.tenantId,
        domainId: event.record.domainId,
      };
      this.propagation.run({
        trigger,
        record: event.record,
        scope,
        subjectId: "system",
      });
      this.audit.record({
        action:
          event.kind === "registered" ? "ontology.register" : "ontology.patch",
        subjectId: "system",
        resource: `${scope.tenantId}/${scope.domainId}/${event.record.ontologyId}/${event.record.entityId}`,
        outcome: "allow",
        tenantId: scope.tenantId,
        domainId: scope.domainId,
        metadata: {
          entityType: event.record.entityType,
          version: event.record.version,
        },
      });
    });
  }

  /**
   * Validates pack rules and registers an entity; triggers propagation via registry events.
   */
  registerEntity(
    _ctx: { tenantId: string; domainId: string },
    input: RegisterEntityInput,
    pack: ResolvedPack,
  ): EntityRecord {
    this.validateEntityForPack(pack, input.entityType, input.properties ?? {});
    return this.store.register(input);
  }

  /**
   * Registers a new entity or patches an existing one (by entityId) after pack validation.
   */
  upsertEntity(
    scope: OntologyScope,
    input: RegisterEntityInput,
    pack: ResolvedPack,
  ): EntityRecord {
    if (!input.entityId) {
      return this.registerEntity(scope, input, pack);
    }
    const existing = this.store.get(scope, input.ontologyId, input.entityId);
    if (!existing) {
      return this.registerEntity(scope, input, pack);
    }
    const entityType = input.entityType ?? existing.entityType;
    const merged = { ...existing.properties, ...input.properties };
    this.validateEntityForPack(pack, entityType, merged);
    return this.store.patch({
      scope,
      ontologyId: input.ontologyId,
      entityId: input.entityId,
      patch: input.properties ?? {},
    });
  }

  /** Awaits durable journal writes when using Postgres-backed store. */
  async flushDurableWrites(): Promise<void> {
    if (this.store instanceof DurableOntologyStore) {
      await this.store.pendingWrites();
    }
  }

  validateEntityForPack(
    pack: ResolvedPack,
    entityType: string | undefined,
    properties: Record<string, unknown>,
  ): void {
    if (!entityType) return;
    const model = pack.models.get(entityType);
    if (!model) {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        `unknown entity type: ${entityType}`,
        400,
      );
    }
    const validation = this.governance.validateEntityProperties(
      model,
      properties,
    );
    if (!validation.valid) {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        `invalid ${entityType}: ${validation.issues.map((i) => i.message).join("; ")}`,
        400,
      );
    }
    if (entityType === "Link") {
      const relation = pack.relations.get("Link");
      const linkValidation = this.governance.validateRelation(
        relation,
        properties,
      );
      if (!linkValidation.valid) {
        throw new DaemonError(
          ErrorCodes.VALIDATION,
          `invalid Link: ${linkValidation.issues.map((i) => i.message).join("; ")}`,
          400,
        );
      }
    }
  }

  assertProductionSsot(env: NodeJS.ProcessEnv = process.env): void {
    if (
      env.NODE_ENV === "production" &&
      !env.DAEMON_POSTGRES_URL &&
      env.DAEMON_SSOT_MODE !== "memory"
    ) {
      throw new DaemonError(
        ErrorCodes.INTERNAL,
        "production requires DAEMON_POSTGRES_URL or explicit DAEMON_SSOT_MODE=memory",
        500,
      );
    }
  }

  createLoop(): LoopOrchestrator {
    const policyPort = {
      evaluate: (action: string, resource: string): PolicyDecision => {
        if (action === "write" && resource.includes("/")) {
          return this.policy.evaluate("write", "entity");
        }
        return this.policy.evaluate(action, resource);
      },
    };
    return new LoopOrchestrator(this.reads, policyPort, this.writes);
  }

  async runWriteLoop(
    scope: OntologyScope,
    req: {
      session: { subjectId: string };
      ontologyId: string;
      entityId: string;
      patch: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ): Promise<
    import("@daemon/read-write-loops/loop-controller/loop-orchestrator.js").LoopOutcome & {
      workflowResults?: string[];
    }
  > {
    await evaluateWriteWithLogicEngine({
      session: req.session as import("@daemon/platform-types").DaemonSession,
      tenantId: scope.tenantId,
      domainId: scope.domainId,
      ontologyId: req.ontologyId as import("@daemon/platform-types").OntologyId,
      entityId: req.entityId as import("@daemon/platform-types").EntityId,
      patch: req.patch,
      idempotencyKey: req.idempotencyKey,
    });
    const loop = this.createLoop();
    const outcome = loop.run({
      session: req.session as import("@daemon/platform-types").DaemonSession,
      tenantId: scope.tenantId,
      domainId: scope.domainId,
      ontologyId: req.ontologyId as import("@daemon/platform-types").OntologyId,
      entityId: req.entityId as import("@daemon/platform-types").EntityId,
      patch: req.patch,
      idempotencyKey: req.idempotencyKey,
    });

    let workflowResults: string[] | undefined;
    if (outcome.state === "committed" && this.actionCatalog) {
      const steps = this.workflowStepsForCommittedWrite(scope, req);
      if (steps.length > 0) {
        workflowResults = await this.workflows.run(steps);
        this.audit.record({
          action: "workflow.execute",
          subjectId: req.session.subjectId,
          resource: `${scope.tenantId}/${scope.domainId}/${req.ontologyId}/${req.entityId}`,
          outcome: "allow",
          tenantId: scope.tenantId,
          domainId: scope.domainId,
          metadata: { workflowResults, trace: outcome.trace },
        });
      }
    }

    this.audit.record({
      action: "loop.write",
      subjectId: req.session.subjectId,
      resource: `${scope.tenantId}/${scope.domainId}/${req.ontologyId}/${req.entityId}`,
      outcome: "allow",
      tenantId: scope.tenantId,
      domainId: scope.domainId,
      metadata: { version: outcome.version, trace: outcome.trace, workflowResults },
    });
    return { ...outcome, workflowResults };
  }

  private workflowStepsForCommittedWrite(
    _scope: OntologyScope,
    _req: { ontologyId: string; entityId: string },
  ): WorkflowStep[] {
    if (!this.actionCatalog) return [];
    const raw = onCommittedStepsFor(this.actionCatalog, "write", "entity");
    return toWorkflowSteps(raw);
  }

  assertAllowed(action: string, resource: string): PolicyDecision {
    const decision = this.policy.evaluate(action, resource);
    if (decision.effect === "deny") {
      throw new DaemonError(
        ErrorCodes.POLICY_DENIED,
        decision.reason ?? `denied ${action} on ${resource}`,
        403,
      );
    }
    return decision;
  }
}

let singleton: DaemonRuntime | undefined;
let initPromise: Promise<DaemonRuntime> | undefined;

/**
 * Initialize runtime with migrations + durable store when DAEMON_POSTGRES_URL is set.
 */
export async function initDaemonRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DaemonRuntime> {
  if (singleton) return singleton;
  if (!initPromise) {
    initPromise = (async () => {
      let store: OntologyStore | undefined;
      if (env.DAEMON_POSTGRES_URL) {
        const { runMigrations } = await import("@daemon/data-platform/migrations");
        await runMigrations(env);
        store = await createOntologyStoreFromEnv(env);
      }
      singleton = new DaemonRuntime({ store });
      const neo4j = singleton.neo4jStore;
      if (neo4j) {
        const schema = buildPackGraphSchema();
        await neo4j.ensureSchema(schema.constraintStatements);
      }
      if (env.DAEMON_POSTGRES_URL && env.DAEMON_SEARCH_REPLAY !== "0") {
        const { PostgresEntityJournal } = await import(
          "@daemon/data-platform/operational-store/entity-journal"
        );
        const { replaySearchIndex } = await import(
          "@daemon/ontology/search/replay-search-index.js"
        );
        const journal = PostgresEntityJournal.fromEnv(env);
        if (journal) {
          const replayLog = new StructuredLogger({
            service: "daemon-search-replay",
          });
          const started = Date.now();
          const count = await replaySearchIndex(singleton.search, journal);
          replayLog.info("search_index_replay", {
            count,
            durationMs: Date.now() - started,
          });
        }
      }
      singleton.assertProductionSsot(env);
      return singleton;
    })();
  }
  return initPromise;
}

export function getDaemonRuntime(): DaemonRuntime {
  if (singleton) return singleton;
  singleton = new DaemonRuntime();
  return singleton;
}

export function resetDaemonRuntimeForTests(): void {
  singleton = undefined;
  initPromise = undefined;
}
