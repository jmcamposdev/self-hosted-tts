import type { ERROR_CODES } from "./error-codes.js";

export type ErrorCode = keyof typeof ERROR_CODES;

/** Error body returned by the API for every non-2xx response. */
export interface ErrorBody {
  error: { code: string; message: string; issues?: unknown };
}
