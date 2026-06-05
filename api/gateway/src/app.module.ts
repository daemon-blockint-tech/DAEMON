import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { ReadModule } from "./read/read.module";
import { WriteModule } from "./write/write.module";
import { PolicyModule } from "./policy/policy.module";
import { AuthModule } from "./auth/auth.module";
import { IngestModule } from "./ingest/ingest.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AutomationsModule } from "./automations/automations.module";
import { ObservabilityModule } from "./observability/observability.module";
import { PlatformModule } from "./platform/platform.module";
import { GovernanceModule } from "./governance/governance.module";
import { QueryModule } from "./query/query.module";
import { SearchModule } from "./search/search.module";
import { LakehouseModule } from "./lakehouse/lakehouse.module";
import { ProductsModule } from "./products/products.module";
import { DataHealthModule } from "./data-health/data-health.module";
import { MediaModule } from "./media/media.module";
import { OntologyModule } from "./ontology/ontology.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { EvalsModule } from "./evals/evals.module";
import { AgentsModule } from "./agents/agents.module";
import { FunctionsModule } from "./functions/functions.module";
import { AdminModule } from "./admin/admin.module";
import { OpsModule } from "./ops/ops.module";

@Module({
  imports: [
    PlatformModule,
    GovernanceModule,
    ObservabilityModule,
    AuthModule,
    HealthModule,
    ReadModule,
    WriteModule,
    PolicyModule,
    IngestModule,
    AnalyticsModule,
    AutomationsModule,
    QueryModule,
    SearchModule,
    LakehouseModule,
    DataHealthModule,
    MediaModule,
    OntologyModule,
    PipelinesModule,
    EvalsModule,
    AgentsModule,
    FunctionsModule,
    AdminModule,
    OpsModule,
    ProductsModule,
  ],
})
export class AppModule {}
