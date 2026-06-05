import { Controller, Get, Headers, Query } from "@nestjs/common";
import { OntologyPackService } from "./ontology-pack.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/ontology")
export class OntologyPackController {
  constructor(
    private readonly packs: OntologyPackService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("pack-resolution")
  packResolution(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("environment") environment?: string,
    @Query("packBranch") packBranch?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.packs.packResolution(ctx, { environment, packBranch });
  }
}
