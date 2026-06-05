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

describe("integration customer GPT", () => {
  it("POST /v1/products/customer-gpt/chat returns citations after ingest", async () => {
    const entityId = `gpt-cite-${Date.now()}`;
    const { baseUrl, close } = await createGatewayTestApp({
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
          sourceId: "gpt-test",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId,
              entityType: "Party",
              properties: {
                displayName: "GptRetrievalTarget",
                entityType: "Party",
              },
            },
          ],
        }),
      });
      assert.equal(ingestRes.status, 201);

      const chatRes = await fetch(`${baseUrl}/v1/products/customer-gpt/chat`, {
        method: "POST",
        headers: {
          ...tenantHeaders,
          "x-session-id": "sess-test-1",
        },
        body: JSON.stringify({
          turns: [{ role: "user", content: "Tell me about GptRetrievalTarget" }],
          ontologyId: FOUNDATION,
          limit: 5,
        }),
      });
      assert.equal(chatRes.status, 201);
      const body = (await chatRes.json()) as {
        message: string;
        citations: string[];
        guardEffect: string;
        sessionId: string | null;
      };
      assert.equal(body.guardEffect, "allow");
      assert.ok(body.message.length > 0);
      assert.ok(
        body.citations.some((c) => c.includes(entityId)),
        `expected citation for ${entityId}, got ${body.citations.join(",")}`,
      );
      assert.equal(body.sessionId, "sess-test-1");
    } finally {
      await close();
    }
  });

  it("persists session citations across gateway restart", async (t) => {
    const postgresUrl = await skipUnlessPostgresReady(t);
    if (!postgresUrl) return;
    const entityId = `gpt-sess-${Date.now()}`;
    const sessionId = `sess-persist-${Date.now()}`;
    const env = {
      DAEMON_POSTGRES_URL: postgresUrl,
      DAEMON_INGEST_SKIP_UPSTREAM: "1",
      DAEMON_AUTH_MODE: "dev",
    };
    const tenantHeaders = authHeaders({
      "x-daemon-tenant": "inst-alpha",
      "x-daemon-domain": "foundation",
    });
    const chatBody = {
      turns: [{ role: "user", content: "Tell me about GptSessionPersistTarget" }],
      ontologyId: FOUNDATION,
      limit: 5,
    };

    const first = await createGatewayTestApp(env);
    try {
      await fetch(`${first.baseUrl}/v1/ingest/records`, {
        method: "POST",
        headers: tenantHeaders,
        body: JSON.stringify({
          sourceId: "gpt-sess",
          records: [
            {
              ontologyId: FOUNDATION,
              entityId,
              entityType: "Party",
              properties: {
                displayName: "GptSessionPersistTarget",
                entityType: "Party",
              },
            },
          ],
        }),
      });

      const chat1 = await fetch(`${first.baseUrl}/v1/products/customer-gpt/chat`, {
        method: "POST",
        headers: { ...tenantHeaders, "x-session-id": sessionId },
        body: JSON.stringify(chatBody),
      });
      assert.equal(chat1.status, 201);
      const body1 = (await chat1.json()) as { citations: string[] };
      assert.ok(body1.citations.length >= 1);
    } finally {
      await first.close();
    }

    const { resetDaemonRuntimeForTests } = await import(
      "../../api/gateway/src/platform/daemon-runtime.js"
    );
    resetDaemonRuntimeForTests();

    const second = await createGatewayTestApp(env);
    try {
      const chat2 = await fetch(`${second.baseUrl}/v1/products/customer-gpt/chat`, {
        method: "POST",
        headers: { ...tenantHeaders, "x-session-id": sessionId },
        body: JSON.stringify({
          ...chatBody,
          turns: [{ role: "user", content: "follow up question" }],
        }),
      });
      assert.equal(chat2.status, 201);
      const body2 = (await chat2.json()) as {
        priorCitations: string[];
        citations: string[];
      };
      assert.ok(
        body2.priorCitations.length >= 1,
        "expected prior citations from Postgres session store",
      );
    } finally {
      await second.close();
    }
  });
});
