import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { MediaService } from "./media.service";
import { TenantContextService } from "../platform/tenant-context";

@Controller("v1/media")
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get("objects")
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query("limit") limit?: string,
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.media.list(ctx, limit ? Number(limit) : 50);
  }

  @Post("objects")
  register(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: {
      uri: string;
      checksum?: string;
      mimeType?: string;
      sizeBytes?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.media.register(ctx, body);
  }

  @Post("upload")
  upload(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body()
    body: { contentBase64: string; mimeType?: string; fileName?: string },
  ) {
    const ctx = this.tenantContext.resolve(headers);
    return this.media.uploadInline(ctx, body);
  }
}
