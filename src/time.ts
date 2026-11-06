import { AppError } from './errors';

/** West Africa Time is UTC+1 all year (no DST), so fixed-offset arithmetic is safe. */
export const WAT_TZ = 'Africa/Lagos';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The WAT calendar date (YYYY-MM-DD) of an instant. */
export function toWatDate(d: Date): string {
  return new Date(d.getTime() + HOUR).toISOString().slice(0, 10);
}

export function assertDateString(s: unknown): string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError('INVALID_DATE', 'Date must be YYYY-MM-DD.', 400);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new AppError('INVALID_DATE', 'Date is not a real calendar date.', 400);
  }
  return s;
}

export function addDays(dateStr: string, n: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
}

/** 23:00 WAT on the given date, as a UTC instant. */
export function sweepCutoff(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 22, 0, 0));
}

/**
 * The inflow window a sweep for `dateStr` covers: [23:00 WAT the day before, 23:00 WAT that day).
 * Contiguous windows mean no inflow is ever skipped. (PRD v2's literal 00:00-22:59:59 window would leave
 * the 23:00-23:59 hour of every day unswept.)
 */
export function sweepWindow(dateStr: string): { from: Date; to: Date } {
  const to = sweepCutoff(dateStr);
  return { from: new Date(to.getTime() - DAY), to };
}

/** The sweep date whose window contains `now` (i.e. which night's sweep this sale will be part of). */
export function currentSweepDate(now: Date): string {
  const wall = new Date(now.getTime() + HOUR);
  const date = wall.toISOString().slice(0, 10);
  return wall.getUTCHours() >= 23 ? addDays(date, 1) : date;
}

export function addDaysToInstant(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

export function addMonthsToInstant(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Feb 2027" in WAT. */
export function formatWatDay(d: Date): string {
  const [y, m, day] = toWatDate(d).split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}
