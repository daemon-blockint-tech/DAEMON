import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { Protected } from "../auth/protected.decorator";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/agents")
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post("sessions")
  @Protected()
  createSession(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: { tools?: string[]; metadata?: Record<string, unknown> },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.agents.createSession(ctx, body ?? {});
  }

  @Get("sessions/:sessionId")
  @Protected()
  getSession(@Param("sessionId") sessionId: string) {
    return this.agents.getSession(sessionId) ?? { status: "not_found" };
  }

  @Post("sessions/:sessionId/tools")
  @Protected()
  invokeTool(
    @Param("sessionId") sessionId: string,
    @Body() body: { tool: string; input: Record<string, unknown> },
  ) {
    return this.agents.invokeTool(sessionId, body);
  }
}
