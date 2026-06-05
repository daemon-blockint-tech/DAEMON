import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpException, HttpStatus } from "@nestjs/common";
import { DaemonError, ErrorCodes } from "@daemon/platform-types";
import { DaemonExceptionFilter } from "./daemon-exception.filter.js";

function mockHost() {
  const body: { status?: number; json?: unknown } = {};
  const res = {
    status(n: number) {
      body.status = n;
      return res;
    },
    json(payload: unknown) {
      body.json = payload;
      return res;
    },
  };
  return {
    host: {
      switchToHttp: () => ({ getResponse: () => res }),
    } as Parameters<DaemonExceptionFilter["catch"]>[1],
    body,
  };
}

describe("DaemonExceptionFilter", () => {
  const filter = new DaemonExceptionFilter();

  it("maps DaemonError to status and code", () => {
    const { host, body } = mockHost();
    filter.catch(
      new DaemonError(ErrorCodes.NOT_FOUND, "missing", 404),
      host,
    );
    assert.equal(body.status, 404);
    assert.deepEqual(body.json, {
      code: ErrorCodes.NOT_FOUND,
      message: "missing",
    });
  });

  it("maps legacy not-found Error messages to 404", () => {
    const { host, body } = mockHost();
    filter.catch(new Error("not found: default/my-entity"), host);
    assert.equal(body.status, 404);
    assert.equal((body.json as { code: string }).code, ErrorCodes.NOT_FOUND);
  });

  it("passes through HttpException", () => {
    const { host, body } = mockHost();
    filter.catch(new HttpException("bad", HttpStatus.BAD_REQUEST), host);
    assert.equal(body.status, 400);
  });
});
