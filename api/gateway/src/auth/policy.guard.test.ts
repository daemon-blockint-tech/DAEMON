import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PolicyService } from "../policy/policy.service";
import { PolicyGuard } from "./policy.guard";
import { PROTECTED_KEY } from "./protected.decorator";
import { POLICY_CHECK_KEY, type PolicyCheckSpec } from "./policy-check.decorator";

interface FakeRequest {
  method?: string;
}

function contextFor(
  request: FakeRequest,
  opts: { protectedRoute?: boolean; spec?: PolicyCheckSpec } = {},
): ExecutionContext {
  const handler = (): void => {};
  if (opts.protectedRoute) {
    Reflect.defineMetadata(PROTECTED_KEY, true, handler);
  }
  if (opts.spec) {
    Reflect.defineMetadata(POLICY_CHECK_KEY, opts.spec, handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const guard = new PolicyGuard(new PolicyService(), new Reflector());

test("unprotected route always passes", async () => {
  assert.equal(await guard.canActivate(contextFor({ method: "DELETE" })), true);
});

test("protected write to entity is allowed by dev default", async () => {
  const ctx = contextFor({ method: "POST" }, { protectedRoute: true });
  assert.equal(await guard.canActivate(ctx), true);
});

test("explicit ingest policy spec is allowed", async () => {
  const ctx = contextFor(
    { method: "POST" },
    { protectedRoute: true, spec: { action: "ingest", resource: "ingest:jobs" } },
  );
  assert.equal(await guard.canActivate(ctx), true);
});

test("denied policy raises forbidden", async () => {
  const ctx = contextFor(
    { method: "DELETE" },
    { protectedRoute: true, spec: { action: "delete", resource: "secret" } },
  );
  await assert.rejects(() => guard.canActivate(ctx), ForbiddenException);
});
