import { Controller, Get, Headers, Query } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";

/**
 * Analytics workflows over the ontology registry (search, reports, dashboards).
 * Policy `query:analytics` is enforced inside {@link AnalyticsWorkflows}.
 */
@Controller("v1/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("search")
  searchReport(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("q") q: string,
    @Query("ontologyId") ontologyId?: string,
    @Query("limit") limit?: string,
    @Query("property") property?: string,
    @Query("propertyValue") propertyValue?: string,
    @Query("reportTitle") reportTitle?: string,
  ) {
    return this.analytics.searchReport(headers, {
      q: q ?? "",
      ontologyId,
      limit: limit ? Number(limit) : undefined,
      property,
      propertyValue,
      reportTitle,
    });
  }

  @Get("entities")
  searchEntities(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("q") q: string,
    @Query("ontologyId") ontologyId?: string,
    @Query("limit") limit?: string,
    @Query("property") property?: string,
    @Query("propertyValue") propertyValue?: string,
  ) {
    return this.analytics.searchEntities(headers, {
      q: q ?? "",
      ontologyId,
      limit: limit ? Number(limit) : undefined,
      property,
      propertyValue,
    });
  }

  @Get("dashboard")
  dashboard(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("ontologyId") ontologyId?: string,
    @Query("breakdownField") breakdownField?: string,
  ) {
    return this.analytics.dashboard(headers, { ontologyId, breakdownField });
  }

  @Get("lakehouse-summary")
  lakehouseSummary(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("since") since?: string,
    @Query("reportTitle") reportTitle?: string,
  ) {
    return this.analytics.lakehouseSummary(headers, { since, reportTitle });
  }
}
