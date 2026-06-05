import { Controller, Get, Headers, Query } from "@nestjs/common";
import { SearchService } from "./search.service";
import { TenantContextService } from "../platform/tenant-context";
import type { SearchMode } from "@daemon/ontology/search/scoped-ontology-search.js";

@Controller("v1/search")
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  search(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("q") q: string,
    @Query("ontologyId") ontologyId?: string,
    @Query("limit") limit?: string,
    @Query("mode") mode?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    const parsedMode =
      mode === "keyword" || mode === "hybrid" ? (mode as SearchMode) : undefined;
    return this.searchService.search(ctx, {
      q: q ?? "",
      ontologyId,
      limit: limit ? Number(limit) : undefined,
      mode: parsedMode,
    });
  }
}
