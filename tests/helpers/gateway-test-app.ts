import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../api/gateway/dist/app.module.js";
import { DaemonExceptionFilter } from "../../api/gateway/dist/daemon-exception.filter.js";
import { resetDaemonRuntimeForTests } from "../../api/gateway/src/platform/daemon-runtime.js";
import { resolvePostgresUrlForTests } from "./postgres-integration.js";

export type GatewayTestApp = {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
};

/** Boots the Nest gateway on a random port for HTTP integration tests. */
export async function createGatewayTestApp(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayTestApp> {
  const prev = { ...process.env };
  const testEnv = { ...env };
  // Use durable Postgres only when the URL is configured and accepting connections.
  const requested = testEnv.DAEMON_POSTGRES_URL;
  if (requested) {
    const ready = await resolvePostgresUrlForTests(String(requested));
    if (ready) {
      testEnv.DAEMON_POSTGRES_URL = ready;
    } else {
      delete testEnv.DAEMON_POSTGRES_URL;
    }
  }
  resetDaemonRuntimeForTests();
  Object.assign(process.env, testEnv);
  if (!testEnv.DAEMON_POSTGRES_URL) {
    delete process.env.DAEMON_POSTGRES_URL;
  }
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new DaemonExceptionFilter());
  await app.listen(0);
  const server = app.getHttpServer();
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 3000;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    baseUrl,
    async close() {
      await app.close();
      Object.assign(process.env, prev);
    },
  };
}

export const DEV_API_KEY = "daemon-dev-key";

/** Tenant/domain headers expected by {@link TenantContextService}. */
export function daemonTenantHeaders(
  tenantId = "inst-alpha",
  domainId = "foundation",
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "x-daemon-tenant": tenantId,
    "x-daemon-domain": domainId,
    ...extra,
  };
}
