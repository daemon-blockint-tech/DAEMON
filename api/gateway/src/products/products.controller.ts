import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/products")
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post("customer-gpt/chat")
  chat(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: {
      turns: { role: "user" | "assistant"; content: string }[];
      ontologyId?: string;
      limit?: number;
    },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    const sessionHeader = headers["x-session-id"];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    return this.products.customerGptChat(ctx, body, sessionId);
  }
}
