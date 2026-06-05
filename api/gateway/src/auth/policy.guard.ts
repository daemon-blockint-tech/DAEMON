import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PolicyService } from "../policy/policy.service";
import { PROTECTED_KEY } from "./protected.decorator";
import { POLICY_CHECK_KEY, type PolicyCheckSpec } from "./policy-check.decorator";

interface PolicyRequest {
  method?: string;
  daemonSession?: { roles?: string[] };
}

const METHOD_ACTIONS: Record<string, string> = {
  GET: "read",
  HEAD: "read",
  POST: "write",
  PUT: "write",
  PATCH: "write",
  DELETE: "delete",
};

/**
 * Enforces a policy decision on {@link Protected} routes. The action/resource
 * come from {@link PolicyCheck} metadata when present, otherwise they are
 * inferred from the HTTP verb (resource defaults to `entity`). Unprotected
 * routes always pass.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly policy: PolicyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isProtected = this.reflector.getAllAndOverride<boolean>(PROTECTED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isProtected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<PolicyRequest>();
    const spec = this.resolveSpec(context, request);
    const decision = await this.policy.check(spec.action, spec.resource);
    if (decision.effect !== "allow") {
      throw new ForbiddenException(
        decision.reason ?? `policy denied ${spec.action}:${spec.resource}`,
      );
    }
    return true;
  }

  private resolveSpec(context: ExecutionContext, request: PolicyRequest): PolicyCheckSpec {
    const declared = this.reflector.getAllAndOverride<PolicyCheckSpec>(POLICY_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (declared) {
      return declared;
    }
    const method = (request.method ?? "POST").toUpperCase();
    return { action: METHOD_ACTIONS[method] ?? "write", resource: "entity" };
  }
}
