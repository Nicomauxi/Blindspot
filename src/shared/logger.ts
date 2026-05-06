import pino from "pino";

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (_logger) return _logger;

  const level = process.env["LOG_LEVEL"] ?? "info";
  const isDev = process.env["NODE_ENV"] !== "production";

  _logger = pino(
    { level },
    isDev
      ? pino.transport({
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        })
      : undefined
  );

  return _logger;
}
