import { Controller, Get, Headers } from "@nestjs/common";
import { OpsService } from "./ops.service";
import { Protected } from "../auth/protected.decorator";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/ops")
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("health")
  health() {
    return this.ops.health();
  }

  @Get("connectors")
  @Protected()
  connectors() {
    return this.ops.listConnectors();
  }

  @Get("jobs")
  @Protected()
  jobs(@Headers() headers: Record<string, string | string[] | undefined>) {
    const ctx = this.tenantContext.resolve(headers);
    return this.ops.listJobs(ctx);
  }
}
