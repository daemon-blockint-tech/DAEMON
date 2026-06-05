import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { LakehouseService } from "./lakehouse.service";
import { LakehouseExportService } from "./lakehouse-export.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/lakehouse")
export class LakehouseController {
  constructor(
    private readonly lakehouse: LakehouseService,
    private readonly exports: LakehouseExportService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("events")
  events(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("since") since?: string,
    @Query("limit") limit?: string,
    @Query("entityType") entityType?: string,
    @Query("ontologyId") ontologyId?: string,
    @Query("changeType") changeType?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.lakehouse.listEvents(ctx, {
      since,
      limit,
      entityType,
      ontologyId,
      changeType,
    });
  }

  @Get("summary")
  summary(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("since") since?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.lakehouse.summarize(ctx, { since });
  }

  @Post("export")
  startExport(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: { since?: string; limit?: number; format?: "jsonl" | "parquet" },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.exports.startExport(ctx, body ?? {});
  }

  @Get("exports/:exportId")
  getExport(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("exportId") exportId: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.exports.getExport(ctx, exportId);
  }
}
