import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { globalRegistry, defaultOntology } from "@daemon/ontology";
import { entityId } from "@daemon/platform-types";
import { createGraphQLServer } from "./server.js";

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createGraphQLServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function gql(base: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(`${base}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: (await res.json()) as { data?: any; errors?: any } };
}

test("health probe responds ok", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("entity query resolves a registered record", async () => {
  await withServer(async (base) => {
    const id = entityId("gql-entity-1");
    globalRegistry.register(defaultOntology(), { name: "Acme" }, id);

    const { status, body } = await gql(
      base,
      `query ($id: String!) { entity(id: $id) { entityId version properties } }`,
      { id: "gql-entity-1" },
    );

    assert.equal(status, 200);
    assert.equal(body.data.entity.entityId, "gql-entity-1");
    assert.equal(body.data.entity.version, 1);
    assert.equal(body.data.entity.properties.name, "Acme");
  });
});

test("entity query returns null for unknown id", async () => {
  await withServer(async (base) => {
    const { body } = await gql(
      base,
      `query { entity(id: "does-not-exist") { entityId } }`,
    );
    assert.equal(body.data.entity, null);
  });
});

test("search matches on properties", async () => {
  await withServer(async (base) => {
    globalRegistry.register(defaultOntology(), { name: "Searchable Widget" }, entityId("gql-search-1"));

    const { body } = await gql(
      base,
      `query { search(q: "searchable") { entityId } }`,
    );

    const ids = body.data.search.map((r: { entityId: string }) => r.entityId);
    assert.ok(ids.includes("gql-search-1"));
  });
});

test("malformed query returns an error", async () => {
  await withServer(async (base) => {
    const { status, body } = await gql(base, `query { nope }`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.errors));
  });
});
