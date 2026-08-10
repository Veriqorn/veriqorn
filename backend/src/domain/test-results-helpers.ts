/**
 * Pure utility functions for test result processing:
 * label normalization, step flattening, diagnostics building.
 */

export type StepNode = {
  id?: string;
  name?: string;
  status?: string;
  statusDetails?: unknown;
  attachments?: Array<{
    id: string;
    name: string;
    type: string;
    source: string;
    isTrace?: boolean;
    traceViewerUrl?: string;
    traceAssetUrl?: string;
    traceTokenExpiresAt?: string;
  }>;
  childSteps?: StepNode[];
};

export type ResultHistoryItem = {
  id: string;
  uuid?: string;
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  testRunId?: string;
};

export const flattenSteps = (steps: StepNode[]): StepNode[] => {
  const flat: StepNode[] = [];
  const stack = [...steps];

  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) {
      continue;
    }

    flat.push(current);
    if (current.childSteps && current.childSteps.length > 0) {
      stack.unshift(...current.childSteps);
    }
  }

  return flat;
};

export const countStepAttachments = (steps: StepNode[]): number => {
  return flattenSteps(steps).reduce((total, step) => {
    return total + (step.attachments?.length ?? 0);
  }, 0);
};

const formatLabelValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeLabelName = (value: string): string => {
  return value.toLowerCase().replace(/[\s.-]+/g, "_");
};

const ALLURE_ID_LABEL_ALIASES = [
  "allure.id",
  "ALLURE_ID",
  "AS_ID",
  "allure_id",
  "allureid",
  "as_id",
  "testcaseid",
  "test_case_id",
  "test_case",
];

const ALLURE_ID_LABEL_NAMES = new Set<string>(
  ALLURE_ID_LABEL_ALIASES.map((name) => normalizeLabelName(name)),
);

const normalizeSingleLabel = (
  entry: unknown,
  fallbackKey: string,
): { name: string; value: string } | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      name: fallbackKey,
      value: formatLabelValue(entry),
    };
  }

  if ("name" in entry || "value" in entry) {
    const raw = entry as Record<string, unknown>;
    const name = String(raw.name || fallbackKey).trim();
    const value = formatLabelValue(raw.value);
    if (!name || !value) {
      return null;
    }

    return {
      name,
      value,
    };
  }

  const [firstKey, firstValue] = Object.entries(entry)[0] || [fallbackKey, ""];
  const value = formatLabelValue(firstValue);
  if (!firstKey || !value) {
    return null;
  }

  return {
    name: String(firstKey),
    value,
  };
};

export const extractResultLabels = (
  labels: unknown,
  parameters: unknown,
): Array<{ name: string; value: string }> => {
  const normalizedFromLabels: Array<{ name: string; value: string }> = [];

  if (Array.isArray(labels)) {
    labels.forEach((entry, index) => {
      const normalized = normalizeSingleLabel(entry, `label_${index + 1}`);
      if (normalized) {
        normalizedFromLabels.push(normalized);
      }
    });
  }

  if (normalizedFromLabels.length > 0) {
    const unique = new Map<string, { name: string; value: string }>();
    normalizedFromLabels.forEach((item) => {
      unique.set(`${normalizeLabelName(item.name)}:${item.value}`, item);
    });
    return Array.from(unique.values());
  }

  if (!parameters) {
    return [];
  }

  if (Array.isArray(parameters)) {
    return parameters
      .map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return {
            name: `param_${index + 1}`,
            value: formatLabelValue(entry),
          };
        }

        if ("name" in entry || "value" in entry) {
          return {
            name: String(
              (entry as Record<string, unknown>).name || `param_${index + 1}`,
            ),
            value: formatLabelValue((entry as Record<string, unknown>).value),
          };
        }

        const [firstKey, firstValue] = Object.entries(entry)[0] || [
          `param_${index + 1}`,
          "",
        ];
        return {
          name: firstKey,
          value: formatLabelValue(firstValue),
        };
      })
      .filter((label) => Boolean(label.name));
  }

  if (typeof parameters === "object") {
    return Object.entries(parameters).map(([name, value]) => ({
      name,
      value: formatLabelValue(value),
    }));
  }

  return [];
};

export const resolveAllureId = (
  labels: unknown,
  parameters: unknown,
): string | null => {
  const allLabels = extractResultLabels(labels, parameters);
  const matched = allLabels.find((label) => {
    return ALLURE_ID_LABEL_NAMES.has(normalizeLabelName(label.name));
  });

  if (!matched) {
    return null;
  }

  const value = matched.value.trim();
  return value.length > 0 ? value : null;
};

export const buildResultDiagnostics = (
  status: string,
  steps: StepNode[],
  totalAttachments: number,
) => {
  const normalizedStatus = String(status || "unknown").toLowerCase();
  const failedStep = flattenSteps(steps).find((step) =>
    ["failed", "broken"].includes(String(step.status || "").toLowerCase()),
  );

  const statusDetails = failedStep?.statusDetails;
  let message: string | null = null;
  let stackTrace: string | null = null;

  if (typeof statusDetails === "string") {
    message = statusDetails;
  } else if (statusDetails && typeof statusDetails === "object") {
    const details = statusDetails as Record<string, unknown>;
    if (typeof details.message === "string") {
      message = details.message;
    }

    if (typeof details.trace === "string") {
      stackTrace = details.trace;
    } else if (typeof details.stackTrace === "string") {
      stackTrace = details.stackTrace;
    } else if (typeof details.stacktrace === "string") {
      stackTrace = details.stacktrace;
    }
  }

  return {
    status: normalizedStatus,
    failedStepName: failedStep?.name ?? null,
    message:
      message ||
      (normalizedStatus === "failed" || normalizedStatus === "broken"
        ? "Failure diagnostics unavailable"
        : null),
    stackTrace,
    hasAttachments: totalAttachments > 0,
  };
};
