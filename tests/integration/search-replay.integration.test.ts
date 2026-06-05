import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createGatewayTestApp,
  DEV_API_KEY,
} from "../helpers/gateway-test-app.js";
import { resetDaemonRuntimeForTests } from "../../api/gateway/src/platform/daemon-runtime.js";
import { skipUnlessPostgresReady } from "../helpers/postgres-integration.js";

const FOUNDATION = "foundation";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": DEV_API_KEY,
    ...extra,
  };
}

describe("integration search index replay", () => {
  it("search works after gateway restart without re-ingest", async (t) => {
    const postgresUrl = await skipUnlessPostgresReady(t);
    if (!postgresUrl) return;
    const entityId = `replay-search-${Date.now()}`;
    const uniqueName = `ReplayUniqueMarker${entityId}`;
    const tenantHeaders = authHeaders({
      "x-daemon-tenant": "inst-alpha",
      "x-daemon-domain": "foundation",
    });

    const env = {
      DAEMON_POSTGRES_URL: postgresUrl,
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    };

    const first = await createGatewayTestApp(env);
    try {
      const ingestRes = await fetch(`${first.baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: tenantHeaders,
        body: JSON.stringify({
          sourceId: "replay-search",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId,
              entityType: "Party",
              properties: {
                displayName: uniqueName,
                entityType: "Party",
              },
            },
          ],
        }),
      });
      assert.equal(ingestRes.status, 201);

      const searchRes = await fetch(
        `${first.baseUrl}/v1/search?q=${encodeURIComponent(uniqueName)}&ontologyId=${FOUNDATION}&limit=5`,
        { headers: tenantHeaders },
      );
      assert.equal(searchRes.status, 200);
      const firstBody = (await searchRes.json()) as {
        hits: { entityId: string }[];
      };
      assert.ok(firstBody.hits.some((h) => h.entityId === entityId));
    } finally {
      await first.close();
    }

    resetDaemonRuntimeForTests();
    const second = await createGatewayTestApp(env);
    try {
      const searchRes = await fetch(
        `${second.baseUrl}/v1/search?q=${encodeURIComponent(uniqueName)}&ontologyId=${FOUNDATION}&limit=5`,
        { headers: tenantHeaders },
      );
      assert.equal(searchRes.status, 200);
      const body = (await searchRes.json()) as {
        hits: { entityId: string }[];
      };
      assert.ok(
        body.hits.some((h) => h.entityId === entityId),
        "expected replayed index to return entity after restart",
      );
    } finally {
      await second.close();
    }
  });
});
