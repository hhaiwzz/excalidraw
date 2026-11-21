import { pointFrom } from "@excalidraw/math";

import {
  BOUND_TEXT_PADDING,
  COLOR_PALETTE,
  FONT_FAMILY,
  ROUNDNESS,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";

import {
  measureText,
  newElement,
  newLinearElement,
  newTextElement,
} from "@excalidraw/element";

import type { RenderEnvironment } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  countWorkdays,
  formatDay,
  getDayOfMonth,
  getMonthLabel,
  getYear,
  isFirstOfMonth,
  isWeekend,
  nextWorkday,
  parseDay,
  startOfWeek,
} from "./timeline.dates";
import { TIMELINE_COLORS, TIMELINE_HOURS_PER_DAY } from "./timeline.types";

import type {
  TimelineColor,
  TimelineData,
  TimelineGroup,
  TimelineMilestone,
  TimelineScale,
  TimelineTask,
} from "./timeline.types";

// -----------------------------------------------------------------------------
// layout constants
// -----------------------------------------------------------------------------

export const TIMELINE_LAYOUT = {
  nameColumnWidth: 200,
  headerHeight: 64,
  milestoneRowHeight: 44,
  rowHeight: 48,
  groupRowHeight: 40,
  /** how far task names inside a group are pushed right */
  groupIndent: 18,
  barHeight: 34,
  bottomPadding: 24,
  dayWidth: { weeks: 18, days: 44 } as Record<TimelineScale, number>,
  /** the longest range we draw, so a typo like year 2205 can't explode */
  maxDays: 3 * 366,
} as const;

/** key used in `customData` to remember what a timeline was made from */
export const TIMELINE_CUSTOM_DATA_KEY = "timeline";

const FONT_SIZE = { title: 16, label: 14, small: 12 } as const;

const TEXT_COLOR = COLOR_PALETTE.black;
const MUTED_TEXT_COLOR = COLOR_PALETTE.gray[3];
const GRID_COLOR = COLOR_PALETTE.gray[2];
const SHADE_COLOR = COLOR_PALETTE.gray[0];
const MILESTONE_COLOR = COLOR_PALETTE.blue[3];
const TODAY_COLOR = COLOR_PALETTE.red[3];

// -----------------------------------------------------------------------------
// data helpers
// -----------------------------------------------------------------------------

/** the longest estimate we accept, in working days (about 3 years) */
const MAX_WORKDAYS = 750;

export type TaskProblem = "missingStart" | "invalidDuration" | null;

const getWorkdays = (task: TimelineTask) =>
  task.durationUnit === "hours"
    ? task.duration / TIMELINE_HOURS_PER_DAY
    : task.duration;

export const getTaskProblem = (task: TimelineTask): TaskProblem => {
  if (parseDay(task.start) === null) {
    return "missingStart";
  }
  const workdays = getWorkdays(task);
  if (!Number.isFinite(workdays) || workdays <= 0 || workdays > MAX_WORKDAYS) {
    return "invalidDuration";
  }
  return null;
};

export type TaskSchedule = {
  /** where the bar starts, as a day number */
  start: number;
  /**
   * where the bar ends (exclusive). It can be a fraction: a 4 hour task
   * that starts on day 10 ends at 10.5.
   */
  end: number;
  /** the last day that has work on it */
  lastDay: number;
};

/**
 * Works out when a task really starts and ends, skipping weekends.
 *
 * Examples (8 working hours = 1 day):
 * - 3 days from Thursday: Thu, Fri, (skip Sat, Sun), Mon -> ends Monday
 * - 4 hours from Tuesday: half of Tuesday
 * - 2 days from Saturday: moves to Monday, ends Tuesday
 */
export const getTaskSchedule = (task: TimelineTask): TaskSchedule | null => {
  if (getTaskProblem(task)) {
    return null;
  }
  const start = nextWorkday(parseDay(task.start)!);
  let remaining = getWorkdays(task);
  let day = start;
  let end = start;
  while (remaining > 1e-9) {
    if (!isWeekend(day)) {
      const work = Math.min(1, remaining);
      remaining -= work;
      end = day + work;
    }
    day++;
  }
  return { start, end, lastDay: Math.ceil(end) - 1 };
};

export type TimelineRange = {
  /** first visible day (inclusive) */
  start: number;
  /** last visible day (exclusive) */
  end: number;
};

/**
 * Picks which days to show: all tasks and milestones plus a little room on
 * both sides. In the "weeks" scale the range is snapped to whole weeks so
 * that every column starts on a Monday.
 */
export const getTimelineRange = (
  data: TimelineData,
  today: number,
): TimelineRange | null => {
  const days: number[] = [];
  for (const task of data.tasks) {
    const schedule = getTaskSchedule(task);
    if (schedule) {
      days.push(schedule.start, schedule.lastDay);
    }
  }
  for (const milestone of data.milestones) {
    const day = parseDay(milestone.date);
    if (day !== null) {
      days.push(day);
    }
  }

  if (!days.length) {
    days.push(today, today + 27);
  }

  let start = Math.min(...days);
  let end = Math.max(...days) + 1;

  if (data.scale === "weeks") {
    start = startOfWeek(start - 3);
    end = startOfWeek(end + 3 + 6);
  } else {
    start -= 2;
    end += 2;
  }

  if (end - start > TIMELINE_LAYOUT.maxDays) {
    return null;
  }
  return { start, end };
};

// -----------------------------------------------------------------------------
// rendering
// -----------------------------------------------------------------------------

export type TimelineLabels = {
  weeks: string;
  days: string;
  taskCount: (count: number) => string;
};

const DEFAULT_LABELS: TimelineLabels = {
  weeks: "Weeks",
  days: "Days",
  taskCount: (count) => `${count} ${count === 1 ? "task" : "tasks"}`,
};

type Style = {
  roughness: number;
  fontFamily: number;
  groupIds: string[];
};

const baseProps = (style: Style) =>
  ({
    roughness: style.roughness,
    groupIds: style.groupIds,
    strokeWidth: 1,
    strokeStyle: "solid",
    fillStyle: "solid",
    opacity: 100,
    locked: false,
  } as const);

const makeText = (
  style: Style,
  opts: {
    text: string;
    x: number;
    y: number;
    fontSize: number;
    color?: string;
    textAlign?: "left" | "center" | "right";
    groupIds?: string[];
    renderEnvironment?: RenderEnvironment;
  },
) =>
  newTextElement({
    ...baseProps(style),
    groupIds: opts.groupIds ?? style.groupIds,
    text: opts.text,
    x: opts.x,
    y: opts.y,
    fontSize: opts.fontSize,
    fontFamily: style.fontFamily,
    strokeColor: opts.color ?? TEXT_COLOR,
    textAlign: opts.textAlign ?? "left",
    verticalAlign: "middle",
    renderEnvironment: opts.renderEnvironment,
  });

const makeLine = (
  style: Style,
  opts: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    color: string;
    dashed?: boolean;
    strokeWidth?: number;
  },
) =>
  newLinearElement({
    ...baseProps(style),
    type: "line",
    x: opts.x,
    y: opts.y,
    strokeColor: opts.color,
    backgroundColor: "transparent",
    strokeStyle: opts.dashed ? "dashed" : "solid",
    strokeWidth: opts.strokeWidth ?? 1,
    roundness: null,
    points: [pointFrom(0, 0), pointFrom(opts.dx, opts.dy)],
  });

const measureWidth = (
  text: string,
  fontSize: number,
  fontFamily: number,
  renderEnvironment?: RenderEnvironment,
) =>
  measureText(
    text,
    getFontString({ fontFamily, fontSize }),
    getLineHeight(fontFamily),
    renderEnvironment,
  ).width;

type TimelineRow =
  | { kind: "task"; task: TimelineTask; inGroup: boolean }
  | { kind: "group"; group: TimelineGroup; tasks: TimelineTask[] };

/**
 * The order of rows on the left: tasks without a group first, then each
 * group followed by its own tasks.
 */
export const getTimelineRows = (data: TimelineData): TimelineRow[] => {
  const groupIds = new Set(data.groups.map((group) => group.id));
  const rows: TimelineRow[] = data.tasks
    .filter((task) => !task.groupId || !groupIds.has(task.groupId))
    .map((task) => ({ kind: "task", task, inGroup: false }));
  for (const group of data.groups) {
    const tasks = data.tasks.filter((task) => task.groupId === group.id);
    rows.push({ kind: "group", group, tasks });
    for (const task of tasks) {
      rows.push({ kind: "task", task, inGroup: true });
    }
  }
  return rows;
};

/**
 * Turns timeline data into plain Excalidraw elements (rectangles, text,
 * lines, diamonds) that are grouped together. Because they're normal
 * elements, people can move, resize, recolor or rename anything afterwards.
 *
 * Example: a 3 day task starting Thursday 2025-12-18 becomes a rounded
 * rectangle from the "18" column to the end of Monday the 22nd (the weekend
 * in between doesn't count as work, but the bar still spans it).
 */
export const renderTimeline = (
  data: TimelineData,
  x: number,
  y: number,
  opts: {
    /** today's day number (see `toDayNumber`) */
    today: number;
    renderEnvironment?: RenderEnvironment;
    /** translated words drawn on the canvas */
    labels?: Partial<TimelineLabels>;
  },
): NonDeletedExcalidrawElement[] | null => {
  const range = getTimelineRange(data, opts.today);
  if (!range) {
    return null;
  }

  const { renderEnvironment } = opts;
  const words = { ...DEFAULT_LABELS, ...opts.labels };
  const L = TIMELINE_LAYOUT;
  const dayWidth = L.dayWidth[data.scale];
  const style: Style = {
    roughness: data.sketchy ? 1 : 0,
    fontFamily: data.sketchy ? FONT_FAMILY.Excalifont : FONT_FAMILY.Nunito,
    groupIds: [randomId()],
  };

  const dayCount = range.end - range.start;
  const gridX = x + L.nameColumnWidth;
  const gridWidth = dayCount * dayWidth;
  const width = L.nameColumnWidth + gridWidth;
  const bodyY = y + L.headerHeight;
  const rowsY = bodyY + L.milestoneRowHeight;
  const rows = getTimelineRows(data);
  const rowHeights = rows.map((row) =>
    row.kind === "group" ? L.groupRowHeight : L.rowHeight,
  );
  const rowsHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const height =
    L.headerHeight +
    L.milestoneRowHeight +
    Math.max(L.rowHeight, rowsHeight) +
    L.bottomPadding;
  const dayX = (day: number) => gridX + (day - range.start) * dayWidth;

  const background: ExcalidrawElement[] = [];
  const grid: ExcalidrawElement[] = [];
  const dividers: ExcalidrawElement[] = [];
  const labels: ExcalidrawElement[] = [];
  const bars: ExcalidrawElement[] = [];
  const markers: ExcalidrawElement[] = [];

  // frame -------------------------------------------------------------------

  background.push(
    newElement({
      ...baseProps(style),
      type: "rectangle",
      x,
      y,
      width,
      height,
      strokeColor: GRID_COLOR,
      backgroundColor: COLOR_PALETTE.white,
      roundness: null,
      customData: { [TIMELINE_CUSTOM_DATA_KEY]: data },
    }),
  );

  // shaded columns: every other week, or weekends when showing days ---------

  const shade = (from: number, to: number) => {
    grid.push(
      newElement({
        ...baseProps(style),
        type: "rectangle",
        x: dayX(from),
        y: bodyY,
        width: (to - from) * dayWidth,
        height: height - L.headerHeight - 1,
        strokeColor: "transparent",
        backgroundColor: SHADE_COLOR,
        roundness: null,
      }),
    );
  };

  if (data.scale === "weeks") {
    for (let day = range.start; day < range.end; day += 14) {
      shade(day, Math.min(day + 7, range.end));
    }
  } else {
    for (let day = range.start; day < range.end; day++) {
      if (isWeekend(day)) {
        shade(day, day + 1);
      }
    }
  }

  // header and dividers -----------------------------------------------------

  dividers.push(
    makeLine(style, {
      x,
      y: bodyY,
      dx: width,
      dy: 0,
      color: GRID_COLOR,
    }),
    makeLine(style, {
      x: gridX,
      y,
      dx: 0,
      dy: height,
      color: GRID_COLOR,
    }),
  );

  const monthRowY = y + 18;
  const dayRowY = y + 44;

  labels.push(
    makeText(style, {
      text: data.scale === "weeks" ? words.weeks : words.days,
      x: x + 16,
      y: y + L.headerHeight / 2,
      fontSize: FONT_SIZE.label,
      color: MUTED_TEXT_COLOR,
      renderEnvironment,
    }),
  );

  // month labels: one at the start of the range and one per new month.
  // Skip the first one when the next month starts right after it, so the
  // two labels don't overlap.
  const showYear = getYear(range.start) !== getYear(range.end - 1);
  const monthStarts: number[] = [range.start];
  for (let day = range.start + 1; day < range.end; day++) {
    if (isFirstOfMonth(day)) {
      monthStarts.push(day);
    }
  }
  monthStarts.forEach((day, index) => {
    const next = monthStarts[index + 1];
    const text = getMonthLabel(day, showYear);
    const textWidth = measureWidth(
      text,
      FONT_SIZE.small,
      style.fontFamily,
      renderEnvironment,
    );
    const available = (next ?? range.end) - day;
    if (available * dayWidth < textWidth + 8) {
      return;
    }
    labels.push(
      makeText(style, {
        text,
        x: dayX(day) + 4,
        y: monthRowY,
        fontSize: FONT_SIZE.small,
        color: TEXT_COLOR,
        renderEnvironment,
      }),
    );
  });

  // circled dates for milestones and today; their tick labels are hidden
  type Highlight = { day: number; color: string };
  const highlights: Highlight[] = [];
  const milestoneDays: { milestone: TimelineMilestone; day: number }[] = [];
  for (const milestone of data.milestones) {
    const day = parseDay(milestone.date);
    if (day !== null && day >= range.start && day < range.end) {
      milestoneDays.push({ milestone, day });
      highlights.push({ day, color: MILESTONE_COLOR });
    }
  }
  const showToday =
    data.showToday && opts.today >= range.start && opts.today < range.end;
  if (showToday) {
    highlights.push({ day: opts.today, color: TODAY_COLOR });
  }

  // in "weeks", a milestone sits on the left edge of its day; in "days" it
  // sits in the middle of its column
  const markerX = (day: number) =>
    dayX(day) + (data.scale === "days" ? dayWidth / 2 : 0);

  const tickDays: number[] = [];
  // in "weeks" the first label would sit on the name column's edge, so the
  // labels start with the second week
  const firstTick = data.scale === "weeks" ? range.start + 7 : range.start;
  for (let day = firstTick; day < range.end; day++) {
    if (data.scale === "days" || (day - range.start) % 7 === 0) {
      tickDays.push(day);
    }
  }
  for (const day of tickDays) {
    const cx = markerX(day);
    if (highlights.some((h) => Math.abs(markerX(h.day) - cx) < 24)) {
      continue;
    }
    labels.push(
      makeText(style, {
        text: String(getDayOfMonth(day)),
        x: cx,
        y: dayRowY,
        fontSize: FONT_SIZE.small,
        color: MUTED_TEXT_COLOR,
        textAlign: "center",
        renderEnvironment,
      }),
    );
  }

  // left column: count + task names -----------------------------------------

  labels.push(
    makeText(style, {
      text: words.taskCount(data.tasks.length),
      x: x + 16,
      y: bodyY + L.milestoneRowHeight / 2,
      fontSize: FONT_SIZE.label,
      color: MUTED_TEXT_COLOR,
      renderEnvironment,
    }),
  );

  const groupBands: ExcalidrawElement[] = [];
  let rowTop = rowsY;
  rows.forEach((row, index) => {
    const rowHeight = rowHeights[index];
    const rowCenterY = rowTop + rowHeight / 2;
    rowTop += rowHeight;

    if (row.kind === "group") {
      // a "lane": a box with a colored border around the group's name and
      // all of its tasks, stretching across the whole timeline
      const shades = COLOR_PALETTE[row.group.color] ?? COLOR_PALETTE.gray;
      const laneTop = rowCenterY - rowHeight / 2 + 3;
      const laneHeight = rowHeight + row.tasks.length * L.rowHeight - 6;
      groupBands.push(
        newElement({
          ...baseProps(style),
          type: "rectangle",
          x: x + 6,
          y: laneTop,
          width: width - 12,
          height: laneHeight,
          strokeColor: "transparent",
          backgroundColor: shades[0],
          opacity: 70,
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        }),
        newElement({
          ...baseProps(style),
          type: "rectangle",
          x: x + 6,
          y: laneTop,
          width: width - 12,
          height: laneHeight,
          strokeColor: shades[3],
          strokeWidth: 2,
          backgroundColor: "transparent",
          roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
          customData: { timelineLane: row.group.id },
        }),
      );
      labels.push(
        makeText(style, {
          text: truncate(
            row.group.name.trim() || " ",
            L.nameColumnWidth - 32,
            FONT_SIZE.title,
            style.fontFamily,
            renderEnvironment,
          ),
          x: x + 16,
          y: rowCenterY,
          fontSize: FONT_SIZE.title,
          color: shades[4],
          renderEnvironment,
        }),
      );
      return;
    }

    const { task, inGroup } = row;
    const indent = inGroup ? L.groupIndent : 0;
    if (task.name.trim()) {
      labels.push(
        makeText(style, {
          text: truncate(
            task.name.trim(),
            L.nameColumnWidth - 32 - indent,
            inGroup ? FONT_SIZE.label : FONT_SIZE.title,
            style.fontFamily,
            renderEnvironment,
          ),
          x: x + 16 + indent,
          y: rowCenterY,
          fontSize: inGroup ? FONT_SIZE.label : FONT_SIZE.title,
          color: inGroup ? COLOR_PALETTE.gray[4] : TEXT_COLOR,
          renderEnvironment,
        }),
      );
    }

    const schedule = getTaskSchedule(task);
    if (!schedule) {
      return;
    }
    bars.push(
      ...renderBar(style, task, {
        x: dayX(schedule.start),
        y: rowCenterY - L.barHeight / 2,
        width: Math.max(4, (schedule.end - schedule.start) * dayWidth),
        height: L.barHeight,
        renderEnvironment,
      }),
    );
  });

  // milestones and today ----------------------------------------------------

  const drawDateMarker = (day: number, color: string) => {
    const cx = markerX(day);
    markers.push(
      makeLine(style, {
        x: cx,
        y: dayRowY + 13,
        dx: 0,
        dy: y + height - (dayRowY + 13),
        color,
        dashed: true,
        strokeWidth: 1,
      }),
      newElement({
        ...baseProps(style),
        type: "ellipse",
        x: cx - 13,
        y: dayRowY - 13,
        width: 26,
        height: 26,
        strokeColor: color,
        backgroundColor: color,
        roundness: null,
      }),
      makeText(style, {
        text: String(getDayOfMonth(day)),
        x: cx,
        y: dayRowY,
        fontSize: FONT_SIZE.small,
        color: COLOR_PALETTE.white,
        textAlign: "center",
        renderEnvironment,
      }),
    );
  };

  if (showToday) {
    drawDateMarker(opts.today, TODAY_COLOR);
  }

  for (const { milestone, day } of milestoneDays) {
    drawDateMarker(day, MILESTONE_COLOR);
    const cx = markerX(day);
    const cy = bodyY + L.milestoneRowHeight / 2;
    markers.push(
      newElement({
        ...baseProps(style),
        type: "diamond",
        x: cx - 7,
        y: cy - 7,
        width: 14,
        height: 14,
        strokeColor: MILESTONE_COLOR,
        backgroundColor: MILESTONE_COLOR,
        roundness: null,
      }),
    );
    if (milestone.name.trim()) {
      markers.push(
        makeText(style, {
          text: milestone.name.trim(),
          x: cx + 12,
          y: cy,
          fontSize: FONT_SIZE.label,
          color: MILESTONE_COLOR,
          renderEnvironment,
        }),
      );
    }
  }

  // bars go above the shading but below milestone lines would hide them, so
  // draw milestone lines first and bars on top (like a real planner)
  const markerLines = markers.filter((el) => el.type === "line");
  const markerRest = markers.filter((el) => el.type !== "line");

  return [
    ...background,
    ...grid,
    ...groupBands,
    ...dividers,
    ...labels,
    ...markerLines,
    ...bars,
    ...markerRest,
  ] as NonDeletedExcalidrawElement[];
};

/** cuts text with "…" so it fits into `maxWidth` */
const truncate = (
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: number,
  renderEnvironment?: RenderEnvironment,
) => {
  if (measureWidth(text, fontSize, fontFamily, renderEnvironment) <= maxWidth) {
    return text;
  }
  let result = text;
  while (
    result.length > 1 &&
    measureWidth(`${result}…`, fontSize, fontFamily, renderEnvironment) >
      maxWidth
  ) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
};

/**
 * A task bar is a rounded rectangle with the task name bound to it (so
 * double-clicking the bar renames it), plus an optional tag "pill". When the
 * name doesn't fit inside a short bar, it's placed just to the right instead.
 */
const renderBar = (
  style: Style,
  task: TimelineTask,
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    renderEnvironment?: RenderEnvironment;
  },
): ExcalidrawElement[] => {
  const { renderEnvironment } = box;
  const shades = COLOR_PALETTE[task.color] ?? COLOR_PALETTE.yellow;
  const barGroupIds = [randomId(), ...style.groupIds];
  const barStyle: Style = { ...style, groupIds: barGroupIds };
  const name = task.name.trim();
  const tag = task.tag.trim();
  const centerY = box.y + box.height / 2;

  const nameWidth = name
    ? measureWidth(name, FONT_SIZE.title, style.fontFamily, renderEnvironment)
    : 0;
  const pillWidth = tag
    ? measureWidth(tag, FONT_SIZE.small, style.fontFamily, renderEnvironment) +
      16
    : 0;
  const innerPadding = 10;
  const pillGap = tag && name ? 10 : 0;
  const nameFitsInside =
    !!name &&
    nameWidth + innerPadding * 2 + BOUND_TEXT_PADDING * 2 <= box.width;

  const barId = randomId();
  const elements: ExcalidrawElement[] = [];

  let nameText: ExcalidrawElement | null = null;
  if (name) {
    nameText = newTextElement({
      ...baseProps(barStyle),
      text: name,
      fontSize: FONT_SIZE.title,
      fontFamily: style.fontFamily,
      strokeColor: TEXT_COLOR,
      textAlign: "left",
      verticalAlign: "middle",
      x: nameFitsInside ? box.x + innerPadding : box.x + box.width + 8,
      y: centerY,
      containerId: nameFitsInside ? barId : null,
      renderEnvironment,
    });
  }

  const bar = {
    ...newElement({
      ...baseProps(barStyle),
      type: "rectangle",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      strokeColor: shades[4],
      backgroundColor: shades[1],
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      boundElements:
        nameText && nameFitsInside ? [{ type: "text", id: nameText.id }] : [],
    }),
    id: barId,
  };
  elements.push(bar);
  if (nameText) {
    elements.push(nameText);
  }

  if (tag) {
    const nameEndX = !name
      ? box.x + innerPadding
      : nameFitsInside
      ? box.x + innerPadding + nameWidth + pillGap
      : box.x + box.width + 8 + nameWidth + pillGap;
    // if the pill doesn't fit inside the bar, put it right after the bar
    const pillX =
      nameFitsInside && nameEndX + pillWidth > box.x + box.width - innerPadding
        ? box.x + box.width + 8
        : nameEndX;
    const pillHeight = 22;
    elements.push(
      newElement({
        ...baseProps(barStyle),
        type: "rectangle",
        x: pillX,
        y: centerY - pillHeight / 2,
        width: pillWidth,
        height: pillHeight,
        strokeColor: shades[4],
        backgroundColor: COLOR_PALETTE.white,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      }),
      makeText(barStyle, {
        text: tag,
        x: pillX + pillWidth / 2,
        y: centerY,
        fontSize: FONT_SIZE.small,
        color: shades[4],
        textAlign: "center",
        renderEnvironment,
      }),
    );
  }

  return elements;
};

// -----------------------------------------------------------------------------
// reading timelines back from the canvas
// -----------------------------------------------------------------------------

/** the timeline data stored on a timeline's background rectangle, if any */
export const getTimelineData = (
  element: ExcalidrawElement | null | undefined,
): TimelineData | null => {
  const value = element?.customData?.[TIMELINE_CUSTOM_DATA_KEY];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.milestones)
  ) {
    return normalizeTimelineData(value);
  }
  return null;
};

/**
 * Fills in anything missing from older or hand-edited data. For example a
 * task saved with an `end` date (before estimates existed) gets its
 * estimate from the number of weekdays between start and end.
 */
export const normalizeTimelineData = (raw: any): TimelineData => {
  const groups: TimelineGroup[] = Array.isArray(raw.groups)
    ? raw.groups
        .filter((group: any) => group && typeof group.id === "string")
        .map((group: any, index: number) => ({
          id: group.id,
          name: String(group.name ?? ""),
          color: TIMELINE_COLORS.includes(group.color)
            ? group.color
            : getDefaultGroupColor(index),
        }))
    : [];
  const groupIds = new Set(groups.map((group) => group.id));

  const tasks: TimelineTask[] = (raw.tasks as any[])
    .filter((task) => task && typeof task === "object")
    .map((task) => {
      let duration = Number(task.duration);
      let durationUnit = task.durationUnit === "hours" ? "hours" : "days";
      if (!(duration > 0)) {
        const start = parseDay(task.start);
        const end = parseDay(task.end);
        duration =
          start !== null && end !== null && end >= start
            ? Math.max(1, countWorkdays(start, end))
            : 1;
        durationUnit = "days";
      }
      return {
        id: typeof task.id === "string" ? task.id : randomId(),
        name: String(task.name ?? ""),
        start: String(task.start ?? ""),
        duration,
        durationUnit,
        groupId:
          typeof task.groupId === "string" && groupIds.has(task.groupId)
            ? task.groupId
            : null,
        color: TIMELINE_COLORS.includes(task.color) ? task.color : "yellow",
        tag: String(task.tag ?? ""),
      } as TimelineTask;
    });

  return {
    scale: raw.scale === "days" ? "days" : "weeks",
    showToday: raw.showToday !== false,
    sketchy: !!raw.sketchy,
    groups,
    tasks,
    milestones: (raw.milestones as any[])
      .filter((milestone) => milestone && typeof milestone === "object")
      .map((milestone) => ({
        id: typeof milestone.id === "string" ? milestone.id : randomId(),
        name: String(milestone.name ?? ""),
        date: String(milestone.date ?? ""),
      })),
  };
};

/**
 * Finds the timeline the user has selected: the background rectangle that
 * carries the data, and the group id shared by all of the timeline's parts.
 */
export const findSelectedTimeline = (
  elements: readonly NonDeletedExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, true>>,
) => {
  const outerGroupId = (element: ExcalidrawElement) =>
    element.groupIds[element.groupIds.length - 1] ?? null;

  // a timeline counts as selected when any of its parts is selected
  const selectedGroupIds = new Set<string>();
  for (const element of elements) {
    const groupId = outerGroupId(element);
    if (selectedElementIds[element.id] && groupId) {
      selectedGroupIds.add(groupId);
    }
  }

  for (const element of elements) {
    const data = getTimelineData(element);
    if (!data) {
      continue;
    }
    const groupId = outerGroupId(element);
    if (
      selectedElementIds[element.id] ||
      (groupId && selectedGroupIds.has(groupId))
    ) {
      return { element, data, groupId };
    }
  }
  return null;
};

/** a different color for each new group: violet, orange, cyan, red, ... */
export const getDefaultGroupColor = (index: number): TimelineColor => {
  const order: TimelineColor[] = [
    "violet",
    "orange",
    "cyan",
    "red",
    "green",
    "blue",
    "yellow",
    "gray",
  ];
  return order[index % order.length];
};

export const createDefaultTimelineData = (today: number): TimelineData => {
  const monday = startOfWeek(today);
  const planning: TimelineGroup = {
    id: randomId(),
    name: "Planning",
    color: "violet",
  };
  const delivery: TimelineGroup = {
    id: randomId(),
    name: "Delivery",
    color: "orange",
  };
  return {
    scale: "weeks",
    showToday: true,
    sketchy: false,
    groups: [planning, delivery],
    tasks: [
      {
        id: randomId(),
        name: "Kickoff",
        start: formatDay(monday),
        duration: 4,
        durationUnit: "hours",
        groupId: null,
        color: "violet",
        tag: "",
      },
      {
        id: randomId(),
        name: "Research",
        start: formatDay(monday),
        duration: 5,
        durationUnit: "days",
        groupId: planning.id,
        color: "blue",
        tag: "",
      },
      {
        id: randomId(),
        name: "Design",
        start: formatDay(monday + 7),
        duration: 8,
        durationUnit: "days",
        groupId: planning.id,
        color: "yellow",
        tag: "Design team",
      },
      {
        id: randomId(),
        name: "Build",
        start: formatDay(monday + 14),
        duration: 15,
        durationUnit: "days",
        groupId: delivery.id,
        color: "green",
        tag: "",
      },
    ],
    milestones: [
      { id: randomId(), name: "Launch", date: formatDay(monday + 37) },
    ],
  };
};
