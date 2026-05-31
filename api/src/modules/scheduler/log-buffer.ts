export type SchedulerLogLine = {
  ts: string;
  level: string;
  msg: string;
};

const MAX_BUFFER = 500;
const buffer: SchedulerLogLine[] = [];

export function pushToSchedulerBuffer(line: SchedulerLogLine): void {
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

export function getSchedulerBuffer(): SchedulerLogLine[] {
  return [...buffer];
}

export function clearSchedulerBuffer(): void {
  buffer.length = 0;
}
