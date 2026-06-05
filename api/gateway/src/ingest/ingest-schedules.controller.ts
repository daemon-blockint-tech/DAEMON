import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { Protected } from "../auth/protected.decorator";
import { PolicyCheck } from "../auth/policy-check.decorator";
import { TenantContextService } from "../platform/tenant-context";
import { IngestScheduleService } from "./ingest-schedule.service";

interface CreateScheduleBody {
  sourceId: string;
  cronExpr: string;
  enabled?: boolean;
}

interface PatchScheduleBody {
  sourceId?: string;
  cronExpr?: string;
  enabled?: boolean;
}

@Controller("v1/ingest/schedules")
export class IngestSchedulesController {
  constructor(
    private readonly schedules: IngestScheduleService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Protected()
  @PolicyCheck("ingest", "ingest-schedule")
  list(@Headers() headers: Record<string, string | string[] | undefined>) {
    const ctx = this.tenantContext.resolve(headers);
    return this.schedules.list(ctx);
  }

  @Post()
  @Protected()
  @PolicyCheck("ingest", "ingest-schedule")
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: CreateScheduleBody,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.schedules.create(ctx, body);
  }

  @Patch(":id")
  @Protected()
  @PolicyCheck("ingest", "ingest-schedule")
  patch(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("id") id: string,
    @Body() body: PatchScheduleBody,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.schedules.patch(ctx, id, body);
  }
}
