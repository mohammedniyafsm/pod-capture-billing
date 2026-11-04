export type PodLogLevel = "info" | "warn" | "error";

export function logPodEvent(
  event: string,
  details: Readonly<Record<string, unknown>> = {},
  level: PodLogLevel = "info",
) {
  const timestamp = new Date().toISOString();
  const lines = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const formatted =
        typeof value === "string"
          ? JSON.stringify(value)
          : JSON.stringify(value, null, 2);
      return `  ${key}: ${(formatted ?? "undefined").replace(/\n/g, "\n  ")}`;
    });
  const message = `[POD ${timestamp}] ${level.toUpperCase()} ${event}${
    lines.length ? `\n${lines.join("\n")}` : ""
  }`;

  console[level](message);
}
