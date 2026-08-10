export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const defaultErrorCode = (status: number): string => {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL_ERROR";
};

const normalizeNestMessage = (value: unknown): { details?: unknown; message: string } => {
  if (Array.isArray(value)) {
    const messages = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    return {
      details: value,
      message: messages[0] || "Request validation failed",
    };
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return { message: value };
  }

  return { details: value, message: "Request failed" };
};

export const normalizeError = (error: unknown): HttpError => {
  if (error instanceof HttpError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "getStatus" in error &&
    typeof error.getStatus === "function" &&
    "getResponse" in error &&
    typeof error.getResponse === "function"
  ) {
    const status = Number(error.getStatus()) || 500;
    const response = error.getResponse() as unknown;
    if (typeof response === "string") {
      return new HttpError(status, defaultErrorCode(status), response);
    }

    if (response && typeof response === "object") {
      const record = response as Record<string, unknown>;
      const normalized = normalizeNestMessage(record.message);
      const errorName = typeof record.error === "string" ? record.error : undefined;
      return new HttpError(
        status,
        errorName?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_") || defaultErrorCode(status),
        normalized.message,
        normalized.details,
      );
    }

    return new HttpError(status, defaultErrorCode(status), error instanceof Error ? error.message : "Request failed");
  }

  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    if (code === 'NOT_FOUND' || error.message === 'NOT_FOUND') {
      return new HttpError(404, 'NOT_FOUND', 'Route not found')
    }
    return new HttpError(500, "INTERNAL_ERROR", error.message);
  }

  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'NOT_FOUND') {
    return new HttpError(404, 'NOT_FOUND', 'Route not found')
  }

  return new HttpError(500, "INTERNAL_ERROR", "Unexpected error");
};

export const toErrorPayload = (error: HttpError, correlationId: string, request?: Request) => ({
  success: false,
  error: {
    code: error.code,
    message: error.message,
    details: error.details,
    correlationId,
  },
  path: request ? new URL(request.url).pathname : undefined,
  timestamp: new Date().toISOString(),
});
