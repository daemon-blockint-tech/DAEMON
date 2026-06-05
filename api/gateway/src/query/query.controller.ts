import { Body, Controller, Headers, Post } from "@nestjs/common";
import { Protected } from "../auth/protected.decorator";
import { PolicyCheck } from "../auth/policy-check.decorator";
import { TenantContextService } from "../platform/tenant-context";
import { QueryService } from "./query.service";
import { AskOntologyQueryDto } from "./query.dto";

@Controller("v1/query")
export class QueryController {
  constructor(
    private readonly query: QueryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post("ask")
  @Protected()
  @PolicyCheck("query", "ontology-nl")
  ask(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: AskOntologyQueryDto,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.query.ask(ctx, body);
  }
}
