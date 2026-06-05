import { DaemonClient, type DaemonClientConfig } from "@daemon/sdk";

export function daemonClientConfig(
  overrides?: Partial<Pick<DaemonClientConfig, "tenantId" | "domainId">>,
): DaemonClientConfig {
  return {
    baseUrl: import.meta.env.VITE_DAEMON_API_URL?.trim() || "/api",
    apiKey: import.meta.env.VITE_DAEMON_API_KEY?.trim() || "daemon-dev-key",
    tenantId:
      overrides?.tenantId ??
      import.meta.env.VITE_DAEMON_TENANT?.trim() ??
      "default",
    domainId:
      overrides?.domainId ??
      import.meta.env.VITE_DAEMON_DOMAIN?.trim() ??
      "foundation",
  };
}

export function createDaemonClient(
  overrides?: Partial<Pick<DaemonClientConfig, "tenantId" | "domainId">>,
): DaemonClient {
  return new DaemonClient(daemonClientConfig(overrides));
}
