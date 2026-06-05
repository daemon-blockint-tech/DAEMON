import { Body, Controller, Headers, Post } from "@nestjs/common";
import { WriteService } from "./write.service";
import type { DaemonSession } from "@daemon/platform-types";
import { Protected } from "../auth/protected.decorator";
import { PolicyCheck } from "../auth/policy-check.decorator";
import { Session } from "../auth/session.decorator";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1")
export class WriteController {
  constructor(
    private readonly writes: WriteService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post("write")
  @Protected()
  @PolicyCheck("write", "entity")
  write(
    @Session() session: DaemonSession,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: {
      entityId: string;
      ontologyId: string;
      patch: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.writes.submit(session, ctx, body);
  }
}
