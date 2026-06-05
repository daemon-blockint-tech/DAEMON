import { Controller, Get, Headers, Param, Query } from "@nestjs/common";
import { PolicyCheck } from "../auth/policy-check.decorator";
import { ReadService } from "./read.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/read")
export class ReadController {
  constructor(
    private readonly reads: ReadService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("entities")
  @PolicyCheck("read", "entity")
  listEntities(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("ontologyId") ontologyId: string,
    @Query("entityType") entityType?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("updatedAfter") updatedAfter?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.reads.listEntities(ctx, {
      ontologyId: ontologyId ?? "foundation",
      entityType,
      limit: limit ? Number(limit) : undefined,
      cursor,
      updatedAfter,
    });
  }

  @Get("entities/:entityId")
  getEntity(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("entityId") entityId: string,
    @Query("ontologyId") ontologyId: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.reads.getEntity(ctx, ontologyId ?? "foundation", entityId);
  }
}
