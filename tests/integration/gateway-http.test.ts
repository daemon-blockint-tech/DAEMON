import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createGatewayTestApp, DEV_API_KEY } from "../helpers/gateway-test-app.js";
import { startMockIngestServer } from "../helpers/mock-ingest-server.js";

const FOUNDATION = "foundation";
const ENT = "ent-http-1";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": DEV_API_KEY,
    ...extra,
  };
}

describe("gateway HTTP", () => {
  it("health is open without credentials", async () => {
    const { baseUrl, close } = await createGatewayTestApp();
    try {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);
    } finally {
      await close();
    }
  });

  it("protected ingest requires api key", async () => {
    const ingest = await startMockIngestServer();
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_URL: ingest.baseUrl,
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const denied = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: "s1", records: [] }),
      });
      assert.equal(denied.status, 401);

      const ok = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          sourceId: "s1",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: ENT,
              entityType: "Party",
              properties: { displayName: "HTTP Party", entityType: "Party" },
            },
          ],
        }),
      });
      assert.equal(ok.status, 201);
    } finally {
      await close();
      await ingest.close();
    }
  });

  it("ingest then read then write on default tenant", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const ingestRes = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          sourceId: "gw-flow",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: "gw-flow-1",
              entityType: "Party",
              properties: { displayName: "Flow Party", entityType: "Party", status: "seed" },
            },
          ],
        }),
      });
      assert.equal(ingestRes.status, 201);

      const readRes = await fetch(
        `${baseUrl}/v1/read/entities/gw-flow-1?ontologyId=${FOUNDATION}`,
        { headers: authHeaders() },
      );
      assert.equal(readRes.status, 200);
      const readBody = (await readRes.json()) as { properties: { status: string } };
      assert.equal(readBody.properties.status, "seed");

      const writeRes = await fetch(`${baseUrl}/v1/write`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ontologyId: FOUNDATION,
          entityId: "gw-flow-1",
          patch: { status: "active" },
        }),
      });
      assert.equal(writeRes.status, 201);

      const afterWrite = await fetch(
        `${baseUrl}/v1/read/entities/gw-flow-1?ontologyId=${FOUNDATION}`,
        { headers: authHeaders() },
      );
      assert.equal(afterWrite.status, 200);
      const afterBody = (await afterWrite.json()) as { properties: { status: string } };
      assert.equal(afterBody.properties.status, "active");
    } finally {
      await close();
    }
  });

  it("source-run ingests demo-parties fixture and patches on re-run", async () => {
    const root = join(import.meta.dirname, "..", "..");
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
      DAEMON_REPO_ROOT: root,
    });
    const tenantHeaders = authHeaders({
      "x-daemon-tenant": "inst-alpha",
      "x-daemon-domain": "foundation",
    });
    try {
      const run1 = await fetch(
        `${baseUrl}/v1/ingest/sources/demo-parties/run`,
        { method: "POST", headers: tenantHeaders },
      );
      assert.equal(run1.status, 201);

      const read1 = await fetch(
        `${baseUrl}/v1/read/entities/party-demo-1?ontologyId=${FOUNDATION}`,
        { headers: tenantHeaders },
      );
      assert.equal(read1.status, 200);
      const body1 = (await read1.json()) as {
        version: number;
        properties: { displayName: string };
      };
      assert.equal(body1.properties.displayName, "Demo Party One");
      const versionAfterFirstRun = body1.version;
      assert.ok(versionAfterFirstRun >= 1);

      const run2 = await fetch(
        `${baseUrl}/v1/ingest/sources/demo-parties/run`,
        { method: "POST", headers: tenantHeaders },
      );
      assert.equal(run2.status, 201);

      const read2 = await fetch(
        `${baseUrl}/v1/read/entities/party-demo-1?ontologyId=${FOUNDATION}`,
        { headers: tenantHeaders },
      );
      const body2 = (await read2.json()) as { version: number };
      assert.equal(body2.version, versionAfterFirstRun + 1);
    } finally {
      await close();
    }
  });

  it("isolates entities per tenant header", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    const sharedId = "shared-tenant-ent";
    try {
      for (const [tenant, name] of [
        ["inst-alpha", "Alpha Party"],
        ["ent-beta", "Beta Party"],
      ] as const) {
        const res = await fetch(`${baseUrl}/v1/ingest/records`, {
          method: "POST",
          headers: authHeaders({
            "x-daemon-tenant": tenant,
            "x-daemon-domain": "foundation",
          }),
          body: JSON.stringify({
            sourceId: tenant,
            records: [
              {
                ontologyId: FOUNDATION,
                entityId: sharedId,
                entityType: "Party",
                properties: { displayName: name, entityType: "Party" },
              },
            ],
          }),
        });
        assert.equal(res.status, 201, tenant);
      }

      const alphaRead = await fetch(
        `${baseUrl}/v1/read/entities/${sharedId}?ontologyId=${FOUNDATION}`,
        {
          headers: authHeaders({
            "x-daemon-tenant": "inst-alpha",
            "x-daemon-domain": "foundation",
          }),
        },
      );
      assert.equal(alphaRead.status, 200);
      const alpha = (await alphaRead.json()) as { properties: { displayName: string } };
      assert.equal(alpha.properties.displayName, "Alpha Party");

      const betaRead = await fetch(
        `${baseUrl}/v1/read/entities/${sharedId}?ontologyId=${FOUNDATION}`,
        {
          headers: authHeaders({
            "x-daemon-tenant": "ent-beta",
            "x-daemon-domain": "foundation",
          }),
        },
      );
      assert.equal(betaRead.status, 200);
      const beta = (await betaRead.json()) as { properties: { displayName: string } };
      assert.equal(beta.properties.displayName, "Beta Party");
    } finally {
      await close();
    }
  });

  it("rejects unknown domain with 400", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const res = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders({
          "x-daemon-tenant": "default",
          "x-daemon-domain": "no-such-domain",
        }),
        body: JSON.stringify({
          sourceId: "bad-domain",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: "bad-domain-1",
              entityType: "Party",
              properties: { displayName: "X", entityType: "Party" },
            },
          ],
        }),
      });
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("rejects domain not enabled for tenant with 403", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const res = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders({
          "x-daemon-tenant": "inst-alpha",
          "x-daemon-domain": "aml-compliance",
        }),
        body: JSON.stringify({
          sourceId: "disabled-domain",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: "disabled-domain-1",
              entityType: "Party",
              properties: { displayName: "X", entityType: "Party" },
            },
          ],
        }),
      });
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  it("ingests logistics-commercial P1 entities on logistics domain", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const res = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders({
          "x-daemon-tenant": "logistics-pilot",
          "x-daemon-domain": "logistics",
        }),
        body: JSON.stringify({
          sourceId: "logistics-p1",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: "log-lead-1",
              entityType: "Lead",
              properties: {
                displayName: "Pilot Lead",
                entityType: "Lead",
                status: "new",
                accountRef: "log-acct-1",
              },
            },
            {
              ontologyId: FOUNDATION,
              entityId: "log-trip-1",
              entityType: "Trip",
              properties: {
                tripCode: "TRIP-001",
                entityType: "Trip",
                status: "planned",
              },
            },
            {
              ontologyId: FOUNDATION,
              entityId: "log-signal-1",
              entityType: "Signal",
              properties: {
                signalType: "expansion",
                entityType: "Signal",
                stage: "qualified",
                accountRef: "log-acct-1",
              },
            },
          ],
        }),
      });
      assert.equal(res.status, 201);
      const readLead = await fetch(
        `${baseUrl}/v1/read/entities/log-lead-1?ontologyId=${FOUNDATION}`,
        {
          headers: authHeaders({
            "x-daemon-tenant": "logistics-pilot",
            "x-daemon-domain": "logistics",
          }),
        },
      );
      assert.equal(readLead.status, 200);
      const body = (await readLead.json()) as { entityType: string };
      assert.equal(body.entityType, "Lead");
    } finally {
      await close();
    }
  });

  it("ingests logistics-commercial P0 entities on logistics domain", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const res = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders({
          "x-daemon-tenant": "logistics-pilot",
          "x-daemon-domain": "logistics",
        }),
        body: JSON.stringify({
          sourceId: "logistics-p0",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: "log-acct-1",
              entityType: "Account",
              properties: {
                displayName: "Pilot Account",
                entityType: "Account",
                status: "active",
              },
            },
            {
              ontologyId: FOUNDATION,
              entityId: "log-ship-1",
              entityType: "Shipment",
              properties: {
                displayName: "Pilot Shipment",
                entityType: "Shipment",
                status: "open",
                orderRef: "ord-1",
              },
            },
            {
              ontologyId: FOUNDATION,
              entityId: "log-mnf-1",
              entityType: "Manifest",
              properties: {
                displayName: "Pilot Manifest",
                entityType: "Manifest",
                status: "draft",
              },
            },
          ],
        }),
      });
      assert.equal(res.status, 201);
      const readShip = await fetch(
        `${baseUrl}/v1/read/entities/log-ship-1?ontologyId=${FOUNDATION}`,
        {
          headers: authHeaders({
            "x-daemon-tenant": "logistics-pilot",
            "x-daemon-domain": "logistics",
          }),
        },
      );
      assert.equal(readShip.status, 200);
      const body = (await readShip.json()) as { entityType: string };
      assert.equal(body.entityType, "Shipment");
    } finally {
      await close();
    }
  });

  it("rejects unknown entity type with 400", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    });
    try {
      const res = await fetch(`${baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          sourceId: "bad-type",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId: "bad-type-1",
              entityType: "NotInPack",
              properties: { displayName: "X", entityType: "NotInPack" },
            },
          ],
        }),
      });
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("ontology NL query returns 503 when feature is disabled", async () => {
    const { baseUrl, close } = await createGatewayTestApp({
      DAEMON_AUTH_MODE: "dev",
      DAEMON_ONTOLOGY_QUERY_ENABLED: "0",
    });
    try {
      const res = await fetch(`${baseUrl}/v1/query/ask`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ question: "How many cases exist?" }),
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { message?: string };
      assert.match(body.message ?? "", /disabled/i);
    } finally {
      await close();
    }
  });
});
