import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayTestApp, DEV_API_KEY } from "../helpers/gateway-test-app.js";
import { PostgresClient } from "@daemon/data-platform/operational-store";
import { withTenantSession } from "@daemon/data-platform/operational-store/tenant-session";
import { skipUnlessPostgresReady } from "../helpers/postgres-integration.js";

const FOUNDATION = "foundation";
const TENANT = "inst-alpha";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": DEV_API_KEY,
    ...extra,
  };
}

describe("integration lakehouse silver and gold", () => {
  it("register upserts silver and summary returns gold rollups", async (t) => {
    const postgresUrl = await skipUnlessPostgresReady(t);
    if (!postgresUrl) return;
    const entityId = `silver-${Date.now()}`;
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_POSTGRES_URL: postgresUrl,
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    const tenantHeaders = authHeaders({
      "x-daemon-tenant": TENANT,
      "x-daemon-domain": "foundation",
    });
    try {
      const ingestRes = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: tenantHeaders,
        body: JSON.stringify({
          sourceId: "silver-test",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId,
              entityType: "Party",
              properties: {
                displayName: "Silver Party",
                entityType: "Party",
              },
            },
          ],
        }),
      });
      assert.equal(ingestRes.status, 201);

      const pg = new PostgresClient({ connectionString: postgresUrl });
      try {
        let silver: { entity_id: string } | undefined;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          silver = await withTenantSession(pg, TENANT, async (client) => {
            const result = await client.query<{ entity_id: string }>(
              `SELECT entity_id FROM daemon_lakehouse_silver_entity
               WHERE tenant_id = $1 AND domain_id = $2 AND ontology_id = $3 AND entity_id = $4`,
              [TENANT, "foundation", FOUNDATION, entityId],
            );
            return result.rows[0];
          });
          if (silver?.entity_id === entityId) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        assert.ok(silver?.entity_id === entityId, "lakehouse-silver row not materialized");
      } finally {
        await pg.close();
      }

      const summaryRes = await fetch(`${baseUrl}/v1/lakehouse/summary`, {
        headers: tenantHeaders,
      });
      assert.equal(summaryRes.status, 200);
      const summary = (await summaryRes.json()) as {
        entityTypeCounts: { entityType: string; count: number }[];
        changeVolumeByDay: { day: string; changeType: string; count: number }[];
      };
      assert.ok(Array.isArray(summary.entityTypeCounts));
      assert.ok(
        summary.entityTypeCounts.some(
          (r) => r.entityType === "Party" && r.count >= 1,
        ),
        "expected bronze entity type rollup",
      );
      assert.ok(Array.isArray(summary.changeVolumeByDay));
      assert.ok(
        summary.changeVolumeByDay.some((r) => r.changeType === "register"),
      );
    } finally {
      await close();
    }
  });
});
