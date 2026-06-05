import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DaemonError } from "@daemon/platform-types";
import { AuthService, type AuthHeaders } from "./auth.service";
import { PROTECTED_KEY } from "./protected.decorator";

interface RequestWithSession {
  headers: AuthHeaders;
  daemonSession?: ReturnType<AuthService["resolveSession"]>;
}

/**
 * Global guard. Resolves any supplied session and attaches it to the request.
 * Routes marked with {@link Protected} additionally require a non-null session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSession>();

    let session: RequestWithSession["daemonSession"] = null;
    try {
      session = this.auth.resolveSession(request.headers ?? {});
    } catch (error) {
      throw new UnauthorizedException(
        error instanceof DaemonError ? error.message : "authentication failed",
      );
    }
    request.daemonSession = session ?? undefined;

    const isProtected = this.reflector.getAllAndOverride<boolean>(PROTECTED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isProtected && !session) {
      throw new UnauthorizedException("authentication required");
    }
    return true;
  }
}
