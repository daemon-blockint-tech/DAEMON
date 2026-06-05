import { test } from "node:test";
import assert from "node:assert/strict";
import { DaemonError } from "@daemon/platform-types";
import { AuthService } from "./auth.service";

test("returns null when no credential is supplied", () => {
  const auth = AuthService.create({} as NodeJS.ProcessEnv);
  assert.equal(auth.resolveSession({}), null);
});

test("resolves the built-in dev api key in dev mode", () => {
  const auth = AuthService.create({ DAEMON_AUTH_MODE: "dev" } as NodeJS.ProcessEnv);
  const session = auth.resolveSession({ "x-api-key": "daemon-dev-key" });
  assert.ok(session);
  assert.equal(session!.subjectId, "dev");
  assert.deepEqual(session!.roles, ["admin"]);
});

test("rejects an unknown api key", () => {
  const auth = AuthService.create({ DAEMON_AUTH_MODE: "dev" } as NodeJS.ProcessEnv);
  assert.throws(() => auth.resolveSession({ "x-api-key": "nope" }), DaemonError);
});

test("parses configured api keys with roles", () => {
  const auth = AuthService.create({
    DAEMON_AUTH_MODE: "prod",
    DAEMON_API_KEYS: "svc-key:svc-1:tenant-9:read|write",
  } as NodeJS.ProcessEnv);
  const session = auth.resolveSession({ "x-api-key": "svc-key" });
  assert.equal(session!.tenantId, "tenant-9");
  assert.deepEqual(session!.roles, ["read", "write"]);
});

test("decodes a bearer jwt in dev mode", () => {
  const auth = AuthService.create({ DAEMON_AUTH_MODE: "dev" } as NodeJS.ProcessEnv);
  const payload = Buffer.from(
    JSON.stringify({ sub: "alice", tenant: "acme", roles: ["editor"] }),
  ).toString("base64url");
  const token = `h.${payload}.sig`;
  const session = auth.resolveSession({ authorization: `Bearer ${token}` });
  assert.equal(session!.subjectId, "alice");
  assert.equal(session!.tenantId, "acme");
  assert.deepEqual(session!.roles, ["editor"]);
});

test("rejects bearer tokens outside dev mode", () => {
  const auth = AuthService.create({ DAEMON_AUTH_MODE: "prod" } as NodeJS.ProcessEnv);
  assert.throws(
    () => auth.resolveSession({ authorization: "Bearer a.b.c" }),
    DaemonError,
  );
});

test("coerces a pre-issued session header", () => {
  const auth = AuthService.create({ DAEMON_AUTH_MODE: "dev" } as NodeJS.ProcessEnv);
  const session = auth.resolveSession({
    "x-daemon-session": JSON.stringify({ subjectId: "bob", tenantId: "t1" }),
  });
  assert.equal(session!.subjectId, "bob");
  assert.equal(session!.sessionId, "session:bob");
});

test("rejects a malformed session header", () => {
  const auth = AuthService.create({ DAEMON_AUTH_MODE: "dev" } as NodeJS.ProcessEnv);
  assert.throws(
    () => auth.resolveSession({ "x-daemon-session": "{not json" }),
    DaemonError,
  );
});
