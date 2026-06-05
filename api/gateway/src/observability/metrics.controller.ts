import { Controller, Get, Header } from "@nestjs/common";
import { globalHttpMetrics } from "@daemon/observability/metrics/http-metrics.js";
import { globalReadParityMetrics } from "@daemon/read-write-loops/reads/read-parity-metrics.js";

@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  metrics(): string {
    return `${globalHttpMetrics.prometheusText()}${globalReadParityMetrics.prometheusText()}`;
  }
}
