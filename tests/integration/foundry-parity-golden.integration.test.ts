import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayTestApp, DEV_API_KEY } from "../helpers/gateway-test-app.js";
import { skipUnlessPostgresReady } from "../helpers/postgres-integration.js";

const FOUNDATION = "foundation";
const repoRoot = process.env.DAEMON_REPO_ROOT ?? process.cwd();

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": DEV_API_KEY,
    ...extra,
  };
}

async function assertOkJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  assert.ok(res.ok, text);
  return JSON.parse(text) as T;
}

describe("foundry parity golden e2e", () => {
  it("demo-parties run → lakehouse events → read entity (no ingest skip, no domain mocks)", async (t) => {
    const postgresUrl = await skipUnlessPostgresReady(t);
    if (!postgresUrl) return;
    if (process.env.DAEMON_INTEGRATION_REQUIRED !== "1" && !process.env.CI) {
      t.skip("set DAEMON_INTEGRATION_REQUIRED=1 or run in CI");
      return;
    }

    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_POSTGRES_URL: postgresUrl,
      DAEMON_REPO_ROOT: repoRoot,
      DAEMON_AUTH_MODE: "dev",
    });
    const tenantHeaders = authHeaders({
      "x-daemon-tenant": "inst-alpha",
      "x-daemon-domain": "foundation",
    });

    try {
      const runRes = await fetch(`${baseUrl}/v1/ingest/sources/demo-parties/run`, {
        method: "POST",
        headers: tenantHeaders,
        body: JSON.stringify({}),
      });
      const runText = await runRes.text();
      assert.ok(runRes.ok, runText);
      const runBody = JSON.parse(runText) as { accepted?: number };
      assert.ok((runBody.accepted ?? 0) >= 1);

      const eventsRes = await fetch(
        `${baseUrl}/v1/lakehouse/events?ontologyId=${FOUNDATION}&limit=50`,
        { headers: tenantHeaders },
      );
      assert.equal(eventsRes.status, 200);
      const eventsBody = (await eventsRes.json()) as {
        count: number;
        events: { entityId: string }[];
      };
      assert.ok(eventsBody.count >= 1);

      const listRes = await fetch(
        `${baseUrl}/v1/read/entities?ontologyId=${FOUNDATION}&entityType=Party&limit=10`,
        { headers: tenantHeaders },
      );
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as {
        items: { entityId: string }[];
      };
      assert.ok(listBody.items.length >= 1);

      const entityId = listBody.items[0]!.entityId;
      const readRes = await fetch(
        `${baseUrl}/v1/read/entities/${encodeURIComponent(entityId)}?ontologyId=${FOUNDATION}`,
        { headers: tenantHeaders },
      );
      assert.equal(readRes.status, 200);

      const sessionBody = await assertOkJson<{ sessionId: string }>(
        await fetch(`${baseUrl}/v1/agents/sessions`, {
          method: "POST",
          headers: tenantHeaders,
          body: JSON.stringify({ tools: ["read_entity"] }),
        }),
      );
      assert.ok(sessionBody.sessionId);

      const toolBody = await assertOkJson<{ entity?: unknown }>(
        await fetch(
          `${baseUrl}/v1/agents/sessions/${encodeURIComponent(sessionBody.sessionId)}/tools`,
          {
            method: "POST",
            headers: tenantHeaders,
            body: JSON.stringify({
              tool: "read_entity",
              input: { entityId, ontologyId: FOUNDATION },
            }),
          },
        ),
      );
      assert.ok(toolBody.entity);

      const evalBody = await assertOkJson<{ persisted?: boolean }>(
        await fetch(`${baseUrl}/v1/evals/record`, {
          method: "POST",
          headers: tenantHeaders,
          body: JSON.stringify({
            suiteId: "golden",
            name: "parity-golden",
            score: 1,
          }),
        }),
      );
      assert.equal(evalBody.persisted, true);

      const opsRes = await fetch(`${baseUrl}/v1/ops/health`, {
        headers: tenantHeaders,
      });
      assert.equal(opsRes.status, 200);
    } finally {
      await close();
    }
  });
});
