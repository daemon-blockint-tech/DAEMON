import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayTestApp, DEV_API_KEY } from "../helpers/gateway-test-app.js";

const FOUNDATION = "foundation";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": DEV_API_KEY,
    ...extra,
  };
}

describe("integration hybrid search", () => {
  it("register entity then GET /v1/search returns hit", async () => {
    const entityId = `search-hit-${Date.now()}`;
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const ingestRes = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders({
          "x-daemon-tenant": "inst-alpha",
          "x-daemon-domain": "foundation",
        }),
        body: JSON.stringify({
          sourceId: "search-test",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId,
              entityType: "Party",
              properties: {
                displayName: "UniqueSearchableWidget",
                entityType: "Party",
              },
            },
          ],
        }),
      });
      assert.equal(ingestRes.status, 201);

      const searchRes = await fetch(
        `${baseUrl}/v1/search?q=UniqueSearchableWidget&ontologyId=${FOUNDATION}&limit=5`,
        {
          headers: authHeaders({
            "x-daemon-tenant": "inst-alpha",
            "x-daemon-domain": "foundation",
          }),
        },
      );
      assert.equal(searchRes.status, 200);
      const body = (await searchRes.json()) as {
        count: number;
        hits: { entityId: string; score: number }[];
      };
      assert.ok(body.count >= 1);
      assert.ok(
        body.hits.some((h) => h.entityId === entityId && h.score > 0),
      );
    } finally {
      await close();
    }
  });
});
