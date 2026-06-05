import { Injectable } from "@nestjs/common";
import {
  DEFAULT_DOMAIN_ID,
  DEFAULT_TENANT_ID,
  type OntologyScope,
} from "@daemon/context-ports";
import { TenantRegistry } from "@daemon/ontology/tenancy/tenant-registry.js";
import { DomainCatalog } from "@daemon/ontology/tenancy/domain-catalog.js";
import { DaemonError, ErrorCodes } from "@daemon/platform-types";

export interface TenantContextHeaders {
  tenantId: string;
  domainId: string;
}

@Injectable()
export class TenantContextService {
  readonly tenants = TenantRegistry.fromYamlFile();
  readonly domains = DomainCatalog.fromYamlFile();

  resolve(headers: Record<string, string | string[] | undefined>): TenantContextHeaders {
    const tenantId = headerValue(headers["x-daemon-tenant"]) ?? DEFAULT_TENANT_ID;
    const domainId = headerValue(headers["x-daemon-domain"]) ?? DEFAULT_DOMAIN_ID;

    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        `unknown tenant: ${tenantId}`,
        400,
      );
    }
    if (!this.domains.get(domainId)) {
      throw new DaemonError(
        ErrorCodes.VALIDATION,
        `unknown domain: ${domainId}`,
        400,
      );
    }
    if (!tenant.enabledDomains.includes(domainId)) {
      throw new DaemonError(
        ErrorCodes.POLICY_DENIED,
        `domain ${domainId} not enabled for tenant ${tenantId}`,
        403,
      );
    }
    return { tenantId, domainId };
  }

  toScope(ctx: TenantContextHeaders): OntologyScope {
    return { tenantId: ctx.tenantId, domainId: ctx.domainId };
  }
}

function headerValue(
  raw: string | string[] | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}
