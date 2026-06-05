import { Injectable } from "@nestjs/common";
import { defaultOntology } from "@daemon/ontology";
import { ontologyId } from "@daemon/platform-types";
import { AnalyticsWorkflows } from "@daemon/products/analytics-workflows/analytics-workflows.js";
import { LakehouseAnalytics } from "@daemon/products/analytics-workflows/lakehouse-analytics.js";
import { ProductRuntime } from "@daemon/products/shared/product-runtime.js";
import type { AnalyticsReport } from "@daemon/products/analytics-workflows/report-generator.js";
import type { DashboardSpec } from "@daemon/products/analytics-workflows/dashboard-builder.js";
import type { EntityRecord } from "@daemon/ontology";
import { DaemonRuntime } from "../platform/daemon-runtime";
import { TenantContextService } from "../platform/tenant-context";
import type { TenantContextHeaders } from "../platform/tenant-context";

export interface AnalyticsSearchQuery {
  q: string;
  ontologyId?: string;
  limit?: number;
  property?: string;
  propertyValue?: string;
  reportTitle?: string;
}

export interface AnalyticsDashboardQuery {
  ontologyId?: string;
  breakdownField?: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly runtime: DaemonRuntime,
    private readonly tenantContext: TenantContextService,
  ) {}

  private flows(ctx: TenantContextHeaders): AnalyticsWorkflows {
    const product = ProductRuntime.fromGatewayBridge({
      reads: this.runtime.reads,
      writes: this.runtime.writes,
      store: this.runtime.store,
      policy: this.runtime.policy,
      search: this.runtime.search,
      scope: { tenantId: ctx.tenantId, domainId: ctx.domainId },
    });
    return new AnalyticsWorkflows(product);
  }

  async searchReport(
    headers: Record<string, string | string[] | undefined>,
    query: AnalyticsSearchQuery,
  ): Promise<AnalyticsReport> {
    const ctx = this.tenantContext.resolve(headers);
    const ont = ontologyId(query.ontologyId ?? defaultOntology());
    return await this.flows(ctx).searchAndReport({
      query: query.q,
      ontologyId: ont,
      limit: query.limit,
      property: query.property,
      propertyValue: query.propertyValue,
      reportTitle: query.reportTitle,
    });
  }

  async searchEntities(
    headers: Record<string, string | string[] | undefined>,
    query: AnalyticsSearchQuery,
  ): Promise<EntityRecord[]> {
    const ctx = this.tenantContext.resolve(headers);
    const ont = ontologyId(query.ontologyId ?? defaultOntology());
    return await this.flows(ctx).search({
      query: query.q,
      ontologyId: ont,
      limit: query.limit,
      property: query.property,
      propertyValue: query.propertyValue,
    });
  }

  dashboard(
    headers: Record<string, string | string[] | undefined>,
    query: AnalyticsDashboardQuery,
  ): DashboardSpec {
    const ctx = this.tenantContext.resolve(headers);
    const ont = ontologyId(query.ontologyId ?? defaultOntology());
    return this.flows(ctx).buildDashboard(ont, {
      breakdownField: query.breakdownField,
    });
  }

  async lakehouseSummary(
    headers: Record<string, string | string[] | undefined>,
    query: { since?: string; reportTitle?: string },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    const product = ProductRuntime.fromGatewayBridge({
      reads: this.runtime.reads,
      writes: this.runtime.writes,
      store: this.runtime.store,
      policy: this.runtime.policy,
      search: this.runtime.search,
      scope: { tenantId: ctx.tenantId, domainId: ctx.domainId },
    });
    const analytics = new LakehouseAnalytics(product, (scope, opts) =>
      this.runtime.lakehouseBronzeReader.summarize(scope, opts),
    );
    return analytics.lakehouseReport({
      since: query.since,
      reportTitle: query.reportTitle,
    });
  }
}
