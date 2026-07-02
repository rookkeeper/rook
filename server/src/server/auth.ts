import type { IncomingMessage } from "node:http";

export interface ServerAuthOptions {
  token?: string;
}

export class ServerAuth {
  private readonly token?: string;

  constructor(options: ServerAuthOptions = {}) {
    this.token = options.token?.trim() || undefined;
  }

  get enabled(): boolean {
    return Boolean(this.token);
  }

  authorizeRequest(request: IncomingMessage): { ok: true } | { ok: false; statusCode: 401; error: string } {
    if (!this.enabled) return { ok: true };
    const expected = `Bearer ${this.token}`;
    const provided = request.headers.authorization;
    if (constantTimeEquals(provided, expected)) return { ok: true };
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }
}

function constantTimeEquals(left: string | undefined, right: string | undefined): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
