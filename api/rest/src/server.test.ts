import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { globalRegistry, defaultOntology } from "@daemon/ontology";
import { entityId, ontologyId } from "@daemon/platform-types";
import { createRestServer } from "./server.js";

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createRestServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("health returns ok", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("metrics endpoint returns prometheus text", async () => {
  await withServer(async (base) => {
    await fetch(`${base}/health`);
    const res = await fetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /daemon_http_requests_total/);
  });
});

test("openapi document is served", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/openapi.json`);
    assert.equal(res.status, 200);
    const doc = (await res.json()) as {
      openapi: string;
      components?: {
        parameters?: Record<string, { name?: string }>;
      };
      paths?: Record<
        string,
        { post?: { parameters?: Array<{ $ref?: string }> }; get?: { parameters?: unknown[] } }
      >;
    };
    assert.equal(doc.openapi, "3.1.0");
    assert.ok(doc.components?.parameters?.DaemonTenantHeader);
    assert.ok(doc.components?.parameters?.DaemonDomainHeader);
    assert.equal(doc.components?.parameters?.DaemonTenantHeader?.name, "X-Daemon-Tenant");
    const writeParams = doc.paths?.["/v1/write"]?.post?.parameters ?? [];
    const refs = writeParams
      .filter((p): p is { $ref: string } => typeof (p as { $ref?: string }).$ref === "string")
      .map((p) => p.$ref);
    assert.ok(refs.includes("#/components/parameters/DaemonTenantHeader"));
    assert.ok(refs.includes("#/components/parameters/DaemonDomainHeader"));

    const requiredPaths = [
      "/v1/read/entities",
      "/v1/read/entities/{entityId}",
      "/v1/search",
      "/v1/lakehouse/summary",
      "/v1/lakehouse/events",
      "/v1/ingest/jobs",
      "/v1/ingest/records",
      "/v1/query/ask",
      "/v1/products/customer-gpt/chat",
      "/v1/policy/check",
      "/v1/automations/run",
    ];
    for (const p of requiredPaths) {
      assert.ok(doc.paths?.[p], `missing OpenAPI path ${p}`);
    }
  });
});

test("read resolves a registered entity", async () => {
  const record = globalRegistry.register(
    defaultOntology(),
    { name: "rest-read" },
    entityId("rest-read-1"),
  );
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/entities/${record.entityId}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { entityId: string; properties: Record<string, unknown> };
    assert.equal(body.entityId, "rest-read-1");
    assert.equal(body.properties.name, "rest-read");
  });
});

test("read returns 404 for unknown entity", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/entities/does-not-exist`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "NOT_FOUND");
  });
});

test("write applies a patch and bumps version", async () => {
  globalRegistry.register(
    defaultOntology(),
    { name: "rest-write", count: 1 },
    entityId("rest-write-1"),
  );
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entityId: "rest-write-1",
        patch: { count: 2 },
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; version: number };
    assert.equal(body.status, "committed");
    assert.equal(body.version, 2);
  });
});

test("analytics search returns a report", async () => {
  const ont = ontologyId(`rest-analytics-${Date.now()}`);
  globalRegistry.register(ont, { label: "metric-a" }, entityId("rest-analytics-1"));
  await withServer(async (base) => {
    const res = await fetch(
      `${base}/v1/analytics/search?q=metric&ontologyId=${encodeURIComponent(ont)}&reportTitle=REST`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { title: string; rowCount: number };
    assert.equal(body.title, "REST");
    assert.equal(body.rowCount, 1);
  });
});

test("analytics entities and dashboard endpoints", async () => {
  const ont = ontologyId(`rest-analytics-dash-${Date.now()}`);
  globalRegistry.register(ont, { status: "ok" }, entityId("rest-dash-1"));
  await withServer(async (base) => {
    const entitiesRes = await fetch(
      `${base}/v1/analytics/entities?q=ok&ontologyId=${encodeURIComponent(ont)}`,
    );
    assert.equal(entitiesRes.status, 200);
    const entities = (await entitiesRes.json()) as { entityId: string }[];
    assert.equal(entities.length, 1);
    const dashRes = await fetch(
      `${base}/v1/analytics/dashboard?ontologyId=${encodeURIComponent(ont)}&breakdownField=status`,
    );
    assert.equal(dashRes.status, 200);
    const dash = (await dashRes.json()) as { ontologyId: string; widgets: unknown[] };
    assert.equal(dash.ontologyId, ont);
    assert.ok(dash.widgets.length > 0);
  });
});

test("automations run evaluate and approve", async () => {
  const ont = ontologyId(`rest-auto-${Date.now()}`);
  globalRegistry.register(ont, { status: "open", amount: 100 }, entityId("rest-auto-1"));
  await withServer(async (base) => {
    const runRes = await fetch(`${base}/v1/automations/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "daemon-dev-key" },
      body: JSON.stringify({
        steps: [{ id: "s1", action: "notify" }],
        loop: {
          ontologyId: ont,
          entityId: "rest-auto-1",
          patch: { status: "done" },
        },
      }),
    });
    assert.equal(runRes.status, 200);
    const run = (await runRes.json()) as { workflowResults: string[]; loop?: { state: string } };
    assert.equal(run.workflowResults[0], "ok:s1:notify");
    assert.equal(run.loop?.state, "committed");

    const evalRes = await fetch(`${base}/v1/automations/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: { amount: 99_999 }, approvals: [] }),
    });
    assert.equal(evalRes.status, 200);
    const decision = (await evalRes.json()) as { requiresApproval: boolean };
    assert.equal(decision.requiresApproval, true);

    const approveRes = await fetch(`${base}/v1/automations/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "daemon-dev-key" },
      body: JSON.stringify({
        loop: {
          ontologyId: ont,
          entityId: "rest-auto-1",
          patch: { amount: 100, status: "ok" },
        },
        approvals: ["mgr-1"],
      }),
    });
    assert.equal(approveRes.status, 200);
    const outcome = (await approveRes.json()) as { state: string };
    assert.equal(outcome.state, "committed");
  });
});

test("write rejects an invalid body", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: {} }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, "VALIDATION");
  });
});
