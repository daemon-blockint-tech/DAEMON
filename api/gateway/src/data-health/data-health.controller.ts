import { Controller, Get, Headers } from "@nestjs/common";
import { DataHealthService } from "./data-health.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/data-health")
export class DataHealthController {
  constructor(
    private readonly dataHealth: DataHealthService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("summary")
  summary(@Headers() headers: Record<string, string | string[] | undefined>) {
    const ctx = this.tenantContext.resolve(headers);
    return this.dataHealth.summary(ctx);
  }
}
