export const TIMELINE_COLORS = [
  "yellow",
  "blue",
  "green",
  "violet",
  "red",
  "orange",
  "cyan",
  "gray",
] as const;

export type TimelineColor = typeof TIMELINE_COLORS[number];

/** "weeks" shows one label per week, "days" shows one label per day */
export type TimelineScale = "weeks" | "days";

/** how a task's estimate is measured */
export type TimelineDurationUnit = "hours" | "days";

/** working hours in one day, used to turn hour estimates into days */
export const TIMELINE_HOURS_PER_DAY = 8;

/**
 * A piece of work that starts on `start` and takes `duration` working
 * hours or days. Weekends are skipped, so 5 days starting on a Wednesday
 * ends on the next Tuesday.
 */
export type TimelineTask = {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  start: string;
  /** the estimate, e.g. 3 (days) or 4 (hours) */
  duration: number;
  durationUnit: TimelineDurationUnit;
  /** the group this task belongs to, or null for no group */
  groupId: string | null;
  color: TimelineColor;
  /** optional short label shown as a pill inside the bar */
  tag: string;
};

/** A named set of tasks, shown as a header row above its tasks. */
export type TimelineGroup = {
  id: string;
  name: string;
};

/** A single important day, drawn as a diamond with a dashed line. */
export type TimelineMilestone = {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
};

export type TimelineData = {
  scale: TimelineScale;
  groups: TimelineGroup[];
  tasks: TimelineTask[];
  milestones: TimelineMilestone[];
  showToday: boolean;
  /** hand-drawn look (roughness 1) instead of clean lines */
  sketchy: boolean;
};
