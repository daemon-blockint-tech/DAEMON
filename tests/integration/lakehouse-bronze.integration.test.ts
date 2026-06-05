import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayTestApp, DEV_API_KEY } from "../helpers/gateway-test-app.js";
import { skipUnlessPostgresReady } from "../helpers/postgres-integration.js";

const FOUNDATION = "foundation";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": DEV_API_KEY,
    ...extra,
  };
}

describe("integration lakehouse bronze", () => {
  it("upsert writes bronze row and GET /v1/lakehouse/events lists it", async (t) => {
    const postgresUrl = await skipUnlessPostgresReady(t);
    if (!postgresUrl) return;
    const entityId = `bronze-${Date.now()}`;
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_POSTGRES_URL: postgresUrl,
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    const tenantHeaders = authHeaders({
      "x-daemon-tenant": "inst-alpha",
      "x-daemon-domain": "foundation",
    });
    try {
      const ingestRes = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: tenantHeaders,
        body: JSON.stringify({
          sourceId: "bronze-test",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId,
              entityType: "Party",
              properties: {
                displayName: "Bronze Party",
                entityType: "Party",
              },
            },
          ],
        }),
      });
      assert.equal(ingestRes.status, 201);

      const eventsRes = await fetch(
        `${baseUrl}/v1/lakehouse/events?limit=20`,
        { headers: tenantHeaders },
      );
      assert.equal(eventsRes.status, 200);
      const body = (await eventsRes.json()) as {
        count: number;
        events: { entityId: string; changeType: string }[];
      };
      assert.ok(body.count >= 1);
      assert.ok(
        body.events.some(
          (e) => e.entityId === entityId && e.changeType === "register",
        ),
      );

      const filteredRes = await fetch(
        `${baseUrl}/v1/lakehouse/events?entityType=Party&changeType=register&ontologyId=${FOUNDATION}&limit=50`,
        { headers: tenantHeaders },
      );
      assert.equal(filteredRes.status, 200);
      const filtered = (await filteredRes.json()) as {
        events: { entityId: string }[];
      };
      assert.ok(
        filtered.events.some((e) => e.entityId === entityId),
        "filtered events should include ingested entity",
      );

      const summaryRes = await fetch(`${baseUrl}/v1/lakehouse/summary`, {
        headers: tenantHeaders,
      });
      assert.equal(summaryRes.status, 200);
      const summary = (await summaryRes.json()) as {
        entityTypeCounts: { entityType: string; count: number }[];
        changeVolumeByDay: unknown[];
      };
      assert.ok(
        summary.entityTypeCounts.some(
          (r) => r.entityType === "Party" && r.count >= 1,
        ),
      );
      assert.ok(summary.changeVolumeByDay.length >= 1);

      const reportRes = await fetch(
        `${baseUrl}/v1/analytics/lakehouse-summary?reportTitle=Bronze%20test`,
        { headers: tenantHeaders },
      );
      assert.equal(reportRes.status, 200);
      const report = (await reportRes.json()) as {
        title: string;
        totalEvents: number;
        summary: { entityTypeCounts: unknown[] };
      };
      assert.equal(report.title, "Bronze test");
      assert.ok(report.totalEvents >= 1);
      assert.ok(report.summary.entityTypeCounts.length >= 1);
    } finally {
      await close();
    }
  });
});
