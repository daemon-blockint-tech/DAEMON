import { Body, Controller, Post } from "@nestjs/common";
import { PolicyService } from "./policy.service";

@Controller("v1/policy")
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Post("check")
  check(@Body() body: { action: string; resource: string }) {
    return this.policy.check(body.action, body.resource);
  }
}
