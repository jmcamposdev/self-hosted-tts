import { ERROR_CODES } from "./error-codes.js";
import type { ErrorCode } from "./errors.types.js";

/** Expected, classified failure. HTTP status and retryability come from the catalog or override. */
export class Fault extends Error {
  readonly status: number;
  readonly transient: boolean;

  constructor(
    public readonly code: string,
    message: string,
    status?: number,
    transient?: boolean,
  ) {
    super(message);
    const catalogEntry = Object.prototype.hasOwnProperty.call(ERROR_CODES, code)
      ? ERROR_CODES[code as ErrorCode]
      : undefined;

    this.status = status ?? catalogEntry?.status ?? 400;
    this.transient = transient ?? catalogEntry?.transient ?? false;
  }
}
