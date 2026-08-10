import { ZodError, type ZodType } from "zod";

import { HttpError } from "./errors";
import { readJsonBody } from "./http";

const toValidationDetails = (error: ZodError) =>
  error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String).join("."),
  }));

const searchParamsToObject = (searchParams: URLSearchParams): Record<string, unknown> => {
  const values: Record<string, unknown> = {};

  for (const [key, value] of searchParams.entries()) {
    const current = values[key];
    if (current === undefined) {
      values[key] = value;
      continue;
    }

    values[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }

  return values;
};

export const validateContract = <T>(
  schema: ZodType<T>,
  value: unknown,
  code = "VALIDATION_ERROR",
  message = "Request validation failed",
): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, code, message, toValidationDetails(parsed.error));
  }

  return parsed.data;
};

export const readValidatedJsonBody = async <T>(
  request: Request,
  schema: ZodType<T>,
  code = "VALIDATION_ERROR",
  message = "Request validation failed",
): Promise<T> => {
  const body = await readJsonBody<unknown>(request);
  return validateContract(schema, body, code, message);
};

export const readValidatedSearch = <T>(
  request: Request,
  schema: ZodType<T>,
  code = "VALIDATION_ERROR",
  message = "Request validation failed",
): T => validateContract(schema, searchParamsToObject(new URL(request.url).searchParams), code, message);
