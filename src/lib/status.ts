/** Human-readable progress on stderr (not pino/telemetry). */
export function logStatus(quiet: boolean | undefined, message: string): void {
  if (quiet === true) return;
  console.error(`agent-review: ${message}`);
}
