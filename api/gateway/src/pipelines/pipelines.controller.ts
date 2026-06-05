import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { PipelinesService } from "./pipelines.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/pipelines")
export class PipelinesController {
  constructor(
    private readonly pipelines: PipelinesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post(":pipelineId/run")
  run(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("pipelineId") pipelineId: string,
    @Body() body: { dag: { nodes: Array<Record<string, unknown>> } },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.pipelines.runPipeline(ctx, pipelineId, {
      nodes: body.dag.nodes.map((n) => ({
        id: String(n.id),
        type: n.type as "source" | "map" | "filter" | "deliver-lakehouse" | "register",
        config: n.config as Record<string, unknown> | undefined,
      })),
    });
  }
}
