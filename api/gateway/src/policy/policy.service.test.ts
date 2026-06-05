import { test } from "node:test";
import assert from "node:assert/strict";
import { PolicyService } from "./policy.service";

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return fn().finally(() => {
    for (const key of Object.keys(saved)) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("allows read on entity by dev default", async () => {
  await withEnv(
    { NODE_ENV: "test", DAEMON_POLICY_MODE: undefined, POLICY_ENGINE_URL: undefined },
    async () => {
      const decision = await new PolicyService().check("read", "entity");
      assert.equal(decision.effect, "allow");
    },
  );
});

test("allows write on entity by dev default", async () => {
  await withEnv(
    { NODE_ENV: "test", DAEMON_POLICY_MODE: undefined, POLICY_ENGINE_URL: undefined },
    async () => {
      const decision = await new PolicyService().check("write", "entity");
      assert.equal(decision.effect, "allow");
    },
  );
});

test("allows ingest on ingest resources", async () => {
  await withEnv(
    { NODE_ENV: "test", DAEMON_POLICY_MODE: undefined, POLICY_ENGINE_URL: undefined },
    async () => {
      const decision = await new PolicyService().check("ingest", "ingest:jobs");
      assert.equal(decision.effect, "allow");
    },
  );
});

test("denies an unknown action/resource pair", async () => {
  await withEnv(
    { NODE_ENV: "test", DAEMON_POLICY_MODE: undefined, POLICY_ENGINE_URL: undefined },
    async () => {
      const decision = await new PolicyService().check("delete", "secret");
      assert.equal(decision.effect, "deny");
    },
  );
});

test("falls back to dev default when policy engine is unreachable in non-prod", async () => {
  await withEnv(
    {
      NODE_ENV: "test",
      DAEMON_POLICY_MODE: undefined,
      POLICY_ENGINE_URL: "http://127.0.0.1:1",
    },
    async () => {
      const decision = await new PolicyService().check("write", "entity");
      assert.equal(decision.effect, "allow");
      assert.equal(decision.reason, "dev-default");
    },
  );
});

test("production denies all checks when POLICY_ENGINE_URL is unset", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DAEMON_POLICY_MODE: undefined,
      POLICY_ENGINE_URL: undefined,
      DAEMON_POLICY_SKIP_UPSTREAM: undefined,
    },
    async () => {
      const read = await new PolicyService().check("read", "entity");
      assert.equal(read.effect, "deny");
      assert.equal(read.reason, "policy-engine-unconfigured");

      const write = await new PolicyService().check("write", "entity");
      assert.equal(write.effect, "deny");
      assert.equal(write.reason, "policy-engine-unconfigured");

      const nl = await new PolicyService().check("query", "ontology-nl");
      assert.equal(nl.effect, "deny");
      assert.equal(nl.reason, "policy-engine-unconfigured");
    },
  );
});

test("production denies write and ontology-nl when upstream is unreachable", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      POLICY_ENGINE_URL: "http://127.0.0.1:1",
      DAEMON_POLICY_SKIP_UPSTREAM: undefined,
    },
    async () => {
      const write = await new PolicyService().check("write", "entity");
      assert.equal(write.effect, "deny");
      assert.equal(write.reason, "policy-engine-unreachable");

      const nl = await new PolicyService().check("query", "ontology-nl");
      assert.equal(nl.effect, "deny");
      assert.equal(nl.reason, "policy-engine-unreachable");
    },
  );
});

test("production denies write when skip-upstream is set", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      POLICY_ENGINE_URL: "http://127.0.0.1:8082",
      DAEMON_POLICY_SKIP_UPSTREAM: "1",
    },
    async () => {
      const write = await new PolicyService().check("write", "entity");
      assert.equal(write.effect, "deny");
      assert.equal(write.reason, "upstream-policy-required");

      const nl = await new PolicyService().check("query", "ontology-nl");
      assert.equal(nl.effect, "deny");
      assert.equal(nl.reason, "upstream-policy-required");
    },
  );
});
