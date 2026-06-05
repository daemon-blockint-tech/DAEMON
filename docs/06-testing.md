# Testing

| Suite | Location | Approach |
|-------|----------|----------|
| Unit | package `*.test.ts`, Go `*_test.go`, Rust `#[test]` | In-process, no mocks for domain logic |
| Contract | `tests/contract/` | OpenAPI shape vs gateway |
| Integration | `tests/integration/` | docker-compose services |
| Policy | `tests/policy/` | YAML fixtures + Rust `PolicyEngine` |
| Ontology | `tests/ontology/` | Registry round-trip |
| E2E | `tests/e2e/` | ingest → read → write path |
| Read parity | `read-write-loops/reads/read-parity*.test.ts`, `read-router.test.ts` | Registry vs projection comparison; `node scripts/measure-read-projection-parity.mjs` |

Integration and e2e do not use `jest.mock` or in-memory fake databases unless `DAEMON_USE_EMBEDDED=1` for local-only dev.

## Local integration stack

```bash
pnpm run dev:up
# or: pnpm exec daemon-cli dev up   (requires @daemon/cli linked at repo root)
# or: docker compose -f deployment/docker/compose.dev.yaml up -d
export DAEMON_REDIS_URL=redis://127.0.0.1:6379
export DAEMON_INTEGRATION_REQUIRED=1
# Migrations (superuser — creates tables + daemon_app role)
DAEMON_POSTGRES_URL=postgresql://daemon:daemon@127.0.0.1:5432/daemon pnpm run db:migrate
# Runtime + integration tests (RLS-enforced app role)
export DAEMON_POSTGRES_URL=postgresql://daemon_app:daemon_app@127.0.0.1:5432/daemon
pnpm run test:repo
```

`tests/integration/gateway-http.test.ts` boots the Nest gateway in-process with a mock ingest HTTP server (in-memory ontology; it does not use `DAEMON_POSTGRES_URL` unless you pass it explicitly). It includes `POST /v1/ingest/sources/demo-parties/run` against `configs/collect-sensing/sources.yaml` and `tests/fixtures/ingest/parties.jsonl` when `DAEMON_REPO_ROOT` points at the repo (set automatically in that test). `tests/e2e/ingest-read-write-http.test.ts` runs the full HTTP chain when `DAEMON_INTEGRATION_REQUIRED=1`. Postgres integration tests skip when `DAEMON_POSTGRES_URL` is unset **or** when nothing is listening on that URL (for example compose is stopped but the variable remains in your shell).

To exercise source-run locally without upstream Go:

```bash
export DAEMON_INGEST_SKIP_UPSTREAM=1
export DAEMON_REPO_ROOT="$(pwd)"
curl -sS -X POST http://127.0.0.1:3000/v1/ingest/sources/demo-parties/run \
  -H "content-type: application/json" \
  -H "x-api-key: daemon-dev-key" \
  -H "x-tenant-id: inst-alpha" \
  -H "x-domain-id: foundation"
```

## Database migrations and durability

Apply versioned SQL before integration tests or gateway boot with Postgres:

```bash
DAEMON_POSTGRES_URL=postgresql://daemon:daemon@127.0.0.1:5432/daemon pnpm run db:migrate
```

Use `daemon_app` for gateway and `test:repo` after migrate (`postgresql://daemon_app:daemon_app@127.0.0.1:5432/daemon`). The compose user `daemon` is a superuser and bypasses row-level security.

Migrations live in `data-platform/migrations/` (`daemon_audit`, `daemon_entity_snapshots`, `daemon_graph_edges`). `initDaemonRuntime()` runs migrations when `DAEMON_POSTGRES_URL` is set, replays entity snapshots into an in-memory registry, and wraps writes with `DurableOntologyStore` (write-through journal).

| Test | Purpose |
|------|---------|
| `tests/integration/stores.integration.test.ts` | ping + `daemon_entity_snapshots` exists after migrate |
| `tests/integration/audit-postgres.integration.test.ts` | `tenantId`, `domainId`, `metadata` round-trip |
| `tests/integration/ontology-durability.integration.test.ts` | register → journal → `replayInto` empty registry |
| `ontology/store/durable-ontology-store.test.ts` | in-memory journal fake (unit) |

CI runs an `integration` job with service containers and the same env vars.

## Neo4j and natural-language query

Local stack includes Neo4j 5 when using `pnpm run dev:up`:

```bash
export DAEMON_NEO4J_URI=bolt://127.0.0.1:7687
export DAEMON_NEO4J_USER=neo4j
export DAEMON_NEO4J_PASSWORD=daemon-dev-neo4j
# Optional read-only role for query execution (defaults to credentials above)
# export DAEMON_NEO4J_QUERY_USER=...
# export DAEMON_NEO4J_QUERY_PASSWORD=...
# export DAEMON_NEO4J_QUERY_TIMEOUT_MS=5000
# export DAEMON_NEO4J_MAX_ROWS=100
```

Backfill Postgres snapshots into Neo4j (after migrate):

```bash
DAEMON_POSTGRES_URL=postgresql://daemon:daemon@127.0.0.1:5432/daemon \
  pnpm exec daemon-cli graph backfill-neo4j --tenant-id default --domain-id foundation
```

Enable gateway NL query (`POST /v1/query/ask`):

```bash
export DAEMON_ONTOLOGY_QUERY_ENABLED=1
export OPENROUTER_API_KEY=<your-key>
export DAEMON_ONTOLOGY_QUERY_MODEL=anthropic/claude-sonnet-4.5
```

| Test | Purpose |
|------|---------|
| `ontology/graph-schema/pack-graph-schema.test.ts` | Pack → Neo4j constraints + LLM schema summary |
| `products/ontology-query/validate-cypher.test.ts` | Read-only Cypher guard |
| `tests/integration/ontology-neo4j-sync.integration.test.ts` | Propagation sync upsert (gated) |
| `tests/integration/ontology-query.integration.test.ts` | LangGraph chain with mock LLM (gated) |

Neo4j integration tests skip unless Bolt is reachable (`skipUnlessNeo4jReady` in `tests/helpers/neo4j-integration.ts`). No OpenRouter key is required in CI for ontology-query tests (mock LLM).
