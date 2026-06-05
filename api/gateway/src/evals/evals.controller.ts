import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { EvalsService } from "./evals.service";
import { Protected } from "../auth/protected.decorator";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/evals")
export class EvalsController {
  constructor(
    private readonly evals: EvalsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post("run")
  @Protected()
  run(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: {
      suite: {
        id: string;
        cases: Array<{
          id: string;
          question: string;
          expectContains?: string[];
        }>;
      };
    },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.evals.runEval(ctx, body.suite);
  }

  @Post("record")
  @Protected()
  record(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: {
      suiteId: string;
      name: string;
      score: number;
      threshold?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.evals.record(ctx, body);
  }

  @Get("runs")
  @Protected()
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("limit") limit?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.evals.list(ctx, limit ? Number(limit) : 20);
  }
}
