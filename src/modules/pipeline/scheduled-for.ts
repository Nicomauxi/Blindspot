import { CronExpressionParser } from "cron-parser";

export function nextCronRun(cronExpression: string, after?: Date): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: after ?? new Date(),
  });
  return interval.next().toDate();
}

export async function updateScheduledFor(
  cronExpression: string,
  after?: Date
): Promise<Date> {
  return nextCronRun(cronExpression, after);
}
