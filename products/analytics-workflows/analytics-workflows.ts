import type { OntologyId } from "@daemon/platform-types";
import { defaultOntology } from "@daemon/ontology";
import { ProductRuntime } from "../shared/product-runtime.js";
import { QueryWizard, type QueryWizardRequest } from "./query-wizard.js";
import { ReportGenerator, type AnalyticsReport } from "./report-generator.js";
import {
  DashboardBuilder,
  type DashboardBuildOptions,
  type DashboardSpec,
} from "./dashboard-builder.js";

export interface SearchReportRequest extends QueryWizardRequest {
  reportTitle?: string;
}

export type { DashboardBuildOptions, DashboardSpec };

/**
 * Facade for analytics-workflows: search → report and registry-backed dashboards.
 */
export class AnalyticsWorkflows {
  readonly query: QueryWizard;
  readonly reports: ReportGenerator;
  readonly dashboards: DashboardBuilder;

  constructor(runtime: ProductRuntime = new ProductRuntime()) {
    this.query = new QueryWizard(runtime);
    this.reports = new ReportGenerator(runtime);
    this.dashboards = new DashboardBuilder(runtime);
  }

  search(req: QueryWizardRequest) {
    return this.query.search(req);
  }

  async searchAndReport(req: SearchReportRequest): Promise<AnalyticsReport> {
    const records = await this.query.search(req);
    const title =
      req.reportTitle ??
      (req.query.trim() ? `Search: ${req.query.trim()}` : "Ontology search");
    return this.reports.generate(title, records);
  }

  buildDashboard(
    ontologyId: OntologyId = defaultOntology(),
    options?: DashboardBuildOptions,
  ): DashboardSpec {
    return this.dashboards.build(ontologyId, options);
  }
}
