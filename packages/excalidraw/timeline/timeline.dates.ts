/**
 * Calendar helpers for the timeline. Dates are handled as whole UTC days
 * ("day numbers" = days since 1970-01-01) so that time zones and daylight
 * saving changes never shift a bar by a day.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2025-12-01" -> day number, or null if the string is not a real date */
export const parseDay = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const time = Date.UTC(year, month, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.round(time / MS_PER_DAY);
};

/** day number -> "2025-12-01" */
export const formatDay = (dayNumber: number): string =>
  new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);

/** the local calendar day of `date` as a day number */
export const toDayNumber = (date: Date): number =>
  Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY,
  );

const toDate = (dayNumber: number) => new Date(dayNumber * MS_PER_DAY);

/** day of month, 1-31 */
export const getDayOfMonth = (dayNumber: number) =>
  toDate(dayNumber).getUTCDate();

/** 0 = Sunday ... 6 = Saturday */
export const getWeekday = (dayNumber: number) => toDate(dayNumber).getUTCDay();

export const isWeekend = (dayNumber: number) => {
  const weekday = getWeekday(dayNumber);
  return weekday === 0 || weekday === 6;
};

/** the Monday on or before the given day */
export const startOfWeek = (dayNumber: number) =>
  dayNumber - ((getWeekday(dayNumber) + 6) % 7);

export const isFirstOfMonth = (dayNumber: number) =>
  getDayOfMonth(dayNumber) === 1;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** e.g. "December" or "January 2026" when the year should be shown */
export const getMonthLabel = (dayNumber: number, withYear: boolean) => {
  const date = toDate(dayNumber);
  const name = MONTH_NAMES[date.getUTCMonth()];
  return withYear ? `${name} ${date.getUTCFullYear()}` : name;
};

export const getYear = (dayNumber: number) =>
  toDate(dayNumber).getUTCFullYear();

/** e.g. "Fri, Dec 12" (in the browser's language) */
export const formatDayForDisplay = (dayNumber: number) =>
  toDate(dayNumber).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** the first weekday (Mon-Fri) on or after the given day */
export const nextWorkday = (dayNumber: number) => {
  let day = dayNumber;
  while (isWeekend(day)) {
    day++;
  }
  return day;
};

/** how many weekdays there are from `start` to `end`, both included */
export const countWorkdays = (start: number, end: number) => {
  let count = 0;
  for (let day = start; day <= end; day++) {
    if (!isWeekend(day)) {
      count++;
    }
  }
  return count;
};
