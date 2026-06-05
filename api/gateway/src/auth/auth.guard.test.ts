import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { PROTECTED_KEY } from "./protected.decorator";

interface FakeRequest {
  headers: Record<string, string>;
  daemonSession?: unknown;
}

function contextFor(request: FakeRequest, protectedRoute: boolean): ExecutionContext {
  const handler = (): void => {};
  if (protectedRoute) {
    Reflect.defineMetadata(PROTECTED_KEY, true, handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const auth = AuthService.create({ DAEMON_AUTH_MODE: "dev" } as NodeJS.ProcessEnv);
const guard = new AuthGuard(auth, new Reflector());

test("attaches a resolved session to the request", () => {
  const request: FakeRequest = { headers: { "x-api-key": "daemon-dev-key" } };
  assert.equal(guard.canActivate(contextFor(request, false)), true);
  assert.ok(request.daemonSession);
});

test("open route passes without a session", () => {
  const request: FakeRequest = { headers: {} };
  assert.equal(guard.canActivate(contextFor(request, false)), true);
  assert.equal(request.daemonSession, undefined);
});

test("protected route without a session is rejected", () => {
  const request: FakeRequest = { headers: {} };
  assert.throws(() => guard.canActivate(contextFor(request, true)), UnauthorizedException);
});

test("malformed credential is surfaced as unauthorized", () => {
  const request: FakeRequest = { headers: { "x-api-key": "bogus" } };
  assert.throws(() => guard.canActivate(contextFor(request, true)), UnauthorizedException);
});
