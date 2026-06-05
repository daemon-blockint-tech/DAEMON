import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { FunctionsService } from "./functions.service";
import { Protected } from "../auth/protected.decorator";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/functions")
export class FunctionsController {
  constructor(
    private readonly functions: FunctionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post(":functionId/invoke")
  @Protected()
  invoke(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("functionId") functionId: string,
    @Body() body: { input?: Record<string, unknown> },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.functions.invoke(ctx, functionId, body?.input ?? {});
  }
}
