function toUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
}

export function getCurrentUsageMonthKey(now: Date = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getUsagePeriodStart(now: Date = new Date()) {
  return toUtcDate(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

export function getUsagePeriodEnd(now: Date = new Date()) {
  return toUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 0);
}

export function getNextMonthlyResetAt(now: Date = new Date()) {
  return toUtcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}
