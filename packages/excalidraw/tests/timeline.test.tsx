import React from "react";

import { Excalidraw } from "../index";
import {
  createDefaultTimelineData,
  findSelectedTimeline,
  formatDay,
  getTaskProblem,
  getTaskSchedule,
  getTimelineData,
  getTimelineRange,
  getTimelineRows,
  normalizeTimelineData,
  parseDay,
  renderTimeline,
  startOfWeek,
  TIMELINE_LAYOUT,
} from "../timeline";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, fireEvent, GlobalTestState, render, waitFor } from "./test-utils";

import type { TimelineData, TimelineTask } from "../timeline";

const { h } = window;

const day = (value: string) => parseDay(value)!;

const makeTask = (overrides: Partial<TimelineTask> = {}): TimelineTask => ({
  id: "t",
  name: "Task",
  start: "2025-12-15",
  duration: 1,
  durationUnit: "days",
  groupId: null,
  color: "green",
  tag: "",
  ...overrides,
});

const makeData = (overrides: Partial<TimelineData> = {}): TimelineData => ({
  scale: "weeks",
  showToday: false,
  sketchy: false,
  groups: [],
  tasks: [
    // Monday 15th + 11 working days -> ends Monday 29th
    makeTask({
      id: "t1",
      name: "Our second task",
      start: "2025-12-15",
      duration: 11,
      color: "yellow",
      tag: "Yellow",
    }),
    makeTask({
      id: "t2",
      name: "Our third task",
      start: "2025-12-11",
      duration: 26,
      color: "blue",
    }),
  ],
  milestones: [{ id: "m1", name: "Deadline", date: "2025-12-30" }],
  ...overrides,
});

describe("timeline dates", () => {
  it("parses and formats ISO days", () => {
    expect(formatDay(day("2025-12-30"))).toBe("2025-12-30");
    expect(day("2026-01-01") - day("2025-12-31")).toBe(1);
  });

  it("rejects invalid dates", () => {
    expect(parseDay("2025-02-30")).toBeNull();
    expect(parseDay("30/12/2025")).toBeNull();
    expect(parseDay("")).toBeNull();
  });

  it("finds the Monday of a week", () => {
    // 2025-12-17 is a Wednesday
    expect(formatDay(startOfWeek(day("2025-12-17")))).toBe("2025-12-15");
    expect(formatDay(startOfWeek(day("2025-12-15")))).toBe("2025-12-15");
    // Sunday belongs to the week that started the Monday before
    expect(formatDay(startOfWeek(day("2025-12-21")))).toBe("2025-12-15");
  });
});

describe("timeline data", () => {
  it("reports task problems", () => {
    const [task] = makeData().tasks;
    expect(getTaskProblem(task)).toBeNull();
    expect(getTaskProblem({ ...task, start: "" })).toBe("missingStart");
    expect(getTaskProblem({ ...task, duration: 0 })).toBe("invalidDuration");
    expect(getTaskProblem({ ...task, duration: NaN })).toBe("invalidDuration");
    expect(getTaskProblem({ ...task, duration: 100000 })).toBe(
      "invalidDuration",
    );
  });

  it("snaps the week range to Mondays and covers every date", () => {
    const range = getTimelineRange(makeData(), day("2025-12-01"))!;
    expect(formatDay(range.start)).toBe("2025-12-08");
    expect(range.start).toBe(startOfWeek(range.start));
    expect(range.end).toBe(startOfWeek(range.end));
    expect(range.end).toBeGreaterThan(
      getTaskSchedule(makeData().tasks[1])!.lastDay,
    );
  });

  it("refuses ranges that are far too long", () => {
    const data = makeData({
      milestones: [{ id: "m", name: "typo", date: "2205-01-01" }],
    });
    expect(getTimelineRange(data, day("2025-12-01"))).toBeNull();
    expect(renderTimeline(data, 0, 0, { today: day("2025-12-01") })).toBeNull();
  });
});

describe("renderTimeline", () => {
  const today = day("2025-12-01");

  it("draws one bar per dated task, sized by its dates", () => {
    const data = makeData();
    const elements = renderTimeline(data, 0, 0, { today })!;
    const range = getTimelineRange(data, today)!;
    const dayWidth = TIMELINE_LAYOUT.dayWidth.weeks;

    const barText = elements.find(
      (el) =>
        el.type === "text" && el.text === "Our second task" && el.containerId,
    )!;
    expect(barText).toBeDefined();
    const bar = elements.find((el) => el.id === (barText as any).containerId)!;

    expect(bar.type).toBe("rectangle");
    expect(bar.x).toBe(
      TIMELINE_LAYOUT.nameColumnWidth +
        (day("2025-12-15") - range.start) * dayWidth,
    );
    // 11 working days from Monday 15th end on Monday 29th, so the bar
    // covers the 15th to the 29th (15 calendar days, 2 weekends included)
    expect(bar.width).toBe(15 * dayWidth);
    expect(bar.boundElements).toEqual([{ type: "text", id: barText.id }]);

    // tag pill
    expect(
      elements.some((el) => el.type === "text" && el.text === "Yellow"),
    ).toBe(true);
  });

  it("draws milestones as a diamond with a dashed line and a label", () => {
    const elements = renderTimeline(makeData(), 0, 0, { today })!;
    expect(elements.filter((el) => el.type === "diamond")).toHaveLength(1);
    expect(
      elements.some((el) => el.type === "line" && el.strokeStyle === "dashed"),
    ).toBe(true);
    expect(
      elements.some((el) => el.type === "text" && el.text === "Deadline"),
    ).toBe(true);
  });

  it("groups everything and stores the source data", () => {
    const data = makeData();
    const elements = renderTimeline(data, 0, 0, { today })!;
    const outerGroupId = elements[0].groupIds[0];
    expect(outerGroupId).toBeTruthy();
    for (const element of elements) {
      expect(element.groupIds[element.groupIds.length - 1]).toBe(outerGroupId);
    }
    expect(getTimelineData(elements[0])).toEqual(data);
  });

  it("still lists tasks without dates, but draws no bar", () => {
    const data = makeData({
      tasks: [makeTask({ name: "No dates yet", start: "" })],
    });
    const elements = renderTimeline(data, 0, 0, { today })!;
    expect(
      elements.some((el) => el.type === "text" && el.text === "No dates yet"),
    ).toBe(true);
    expect(
      elements.some(
        (el) => el.type === "rectangle" && el.backgroundColor === "#b2f2bb",
      ),
    ).toBe(false);
  });

  it("shows one label per day in the days scale", () => {
    const data = makeData({
      scale: "days",
      tasks: [makeTask({ name: "Short", start: "2025-12-03", duration: 3 })],
      milestones: [],
    });
    const elements = renderTimeline(data, 0, 0, { today })!;
    const range = getTimelineRange(data, today)!;
    const dayLabels = elements.filter(
      (el) => el.type === "text" && /^\d+$/.test(el.text),
    );
    expect(dayLabels).toHaveLength(range.end - range.start);
  });

  it("marks today when asked", () => {
    const data = makeData({ showToday: true });
    const inRange = day("2025-12-20");
    const elements = renderTimeline(data, 0, 0, { today: inRange })!;
    expect(
      elements
        .filter((el) => el.type === "ellipse")
        .map((el) => el.strokeColor),
    ).toContain("#fa5252");
  });
});

describe("task estimates", () => {
  const schedule = (task: Partial<TimelineTask>) => {
    const result = getTaskSchedule(makeTask(task))!;
    return {
      start: formatDay(result.start),
      lastDay: formatDay(result.lastDay),
      length: result.end - result.start,
    };
  };

  it("skips weekends when counting days", () => {
    // Thursday + 3 days = Thu, Fri, Mon
    expect(schedule({ start: "2025-12-18", duration: 3 })).toEqual({
      start: "2025-12-18",
      lastDay: "2025-12-22",
      length: 5,
    });
    // a full working week ends on Friday
    expect(schedule({ start: "2025-12-15", duration: 5 }).lastDay).toBe(
      "2025-12-19",
    );
  });

  it("moves a task that starts on a weekend to Monday", () => {
    expect(schedule({ start: "2025-12-20", duration: 2 })).toEqual({
      start: "2025-12-22",
      lastDay: "2025-12-23",
      length: 2,
    });
  });

  it("turns hours into parts of a day (8 hours = 1 day)", () => {
    expect(
      schedule({ start: "2025-12-15", duration: 4, durationUnit: "hours" }),
    ).toEqual({ start: "2025-12-15", lastDay: "2025-12-15", length: 0.5 });
    // 12 hours from Friday = all of Friday + half of Monday
    expect(
      schedule({ start: "2025-12-19", duration: 12, durationUnit: "hours" }),
    ).toEqual({ start: "2025-12-19", lastDay: "2025-12-22", length: 3.5 });
  });

  it("upgrades old timelines that were saved with an end date", () => {
    const old = {
      scale: "weeks",
      showToday: true,
      sketchy: false,
      tasks: [
        {
          id: "t",
          name: "Old",
          start: "2025-12-15",
          end: "2025-12-23",
          color: "blue",
          tag: "",
        },
      ],
      milestones: [],
    };
    const data = normalizeTimelineData(old);
    expect(data.groups).toEqual([]);
    // Mon 15 to Tue 23 = 7 weekdays
    expect(data.tasks[0]).toMatchObject({
      duration: 7,
      durationUnit: "days",
      groupId: null,
    });
    expect(formatDay(getTaskSchedule(data.tasks[0])!.lastDay)).toBe(
      "2025-12-23",
    );
  });
});

describe("timeline groups", () => {
  const today = day("2025-12-01");
  const data = makeData({
    groups: [
      { id: "g1", name: "Design", color: "violet" },
      { id: "g2", name: "Empty group", color: "orange" },
    ],
    tasks: [
      makeTask({ id: "a", name: "In group A", groupId: "g1", duration: 2 }),
      makeTask({ id: "b", name: "No group", groupId: null }),
      makeTask({
        id: "c",
        name: "In group B",
        groupId: "g1",
        start: "2025-12-22",
        duration: 3,
      }),
    ],
    milestones: [],
  });

  it("lists tasks without a group first, then each group with its tasks", () => {
    expect(
      getTimelineRows(data).map((row) =>
        row.kind === "group" ? `[${row.group.name}]` : row.task.name,
      ),
    ).toEqual([
      "No group",
      "[Design]",
      "In group A",
      "In group B",
      "[Empty group]",
    ]);
  });

  it("draws each group as a lane with a colored border around its tasks", () => {
    const elements = renderTimeline(data, 0, 0, { today })!;
    const L = TIMELINE_LAYOUT;
    for (const name of ["Design", "Empty group"]) {
      expect(
        elements.some((el) => el.type === "text" && el.text === name),
      ).toBe(true);
    }
    const lanes = elements.filter((el) => el.customData?.timelineLane);
    expect(lanes.map((lane) => lane.customData!.timelineLane)).toEqual([
      "g1",
      "g2",
    ]);
    // violet border, wide as the timeline
    expect(lanes[0].strokeColor).toBe("#7950f2");
    expect(lanes[0].strokeWidth).toBe(2);
    expect(lanes[0].width).toBe(elements[0].width - 2 * L.lane.insetX);
    // small corners, so they don't cut into the group's name
    expect(lanes[0].roundness).toEqual({ type: 3, value: L.lane.radius });
    // the "Design" lane holds its header row, its 2 tasks and some padding
    expect(lanes[0].height).toBe(
      L.groupRowHeight + 2 * L.rowHeight + L.lane.paddingBottom,
    );
    // the empty group's lane is just its header row and padding
    expect(lanes[1].height).toBe(L.groupRowHeight + L.lane.paddingBottom);
    // the first lane starts a gap below the "No group" task row
    expect(lanes[0].y).toBe(
      L.headerHeight + L.milestoneRowHeight + L.rowHeight + L.lane.gap,
    );
    // and the next lane starts a gap below the first one
    expect(lanes[1].y).toBe(lanes[0].y + lanes[0].height + L.lane.gap);
    // the group's name sits inside its lane, clear of the corner
    const name = elements.find(
      (el) => el.type === "text" && el.text === "Design",
    )!;
    expect(name.x).toBeGreaterThanOrEqual(lanes[0].x + L.lane.radius);
    // no dark summary bars any more
    expect(
      elements.some((el) => el.type === "rectangle" && el.height === 8),
    ).toBe(false);
  });

  it("gives old groups without a color one automatically", () => {
    const upgraded = normalizeTimelineData({
      ...data,
      groups: [{ id: "g1", name: "Old" }],
    });
    expect(upgraded.groups[0].color).toBe("violet");
  });

  it("treats a task whose group was deleted as having no group", () => {
    const rows = getTimelineRows({
      ...data,
      groups: [],
    });
    expect(rows.every((row) => row.kind === "task")).toBe(true);
    expect(rows).toHaveLength(3);
  });
});

describe("timeline dialog", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(
      <Excalidraw
        initialData={{ appState: { openDialog: { name: "timeline" } } }}
      />,
    );
  });

  it("inserts a grouped timeline on the canvas", async () => {
    const dialog = document.querySelector(".TimelineDialog")!;
    expect(dialog).not.toBeNull();
    await waitFor(() =>
      expect(
        dialog.querySelector(".TimelineDialog__preview svg"),
      ).not.toBeNull(),
    );

    const defaultTasks = createDefaultTimelineData(0).tasks.length;
    expect(
      dialog.querySelectorAll("[data-testid^='timeline-task-']"),
    ).toHaveLength(defaultTasks);

    fireEvent.click(dialog.querySelector("[data-testid='timeline-add-task']")!);
    expect(
      dialog.querySelectorAll("[data-testid^='timeline-task-']"),
    ).toHaveLength(defaultTasks + 1);

    const nameInput = dialog.querySelector<HTMLInputElement>(
      `[data-testid='timeline-task-${defaultTasks}'] .TimelineDialog__name`,
    )!;
    fireEvent.change(nameInput, { target: { value: "Ship it" } });

    const insertButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Insert"),
    )!;
    await act(async () => {
      fireEvent.click(insertButton);
    });

    expect(h.state.openDialog).toBeNull();
    expect(
      h.elements.some((el) => el.type === "text" && el.text === "Ship it"),
    ).toBe(true);
    const timeline = h.elements.find((el) => getTimelineData(el))!;
    expect(timeline).toBeDefined();
    expect(getTimelineData(timeline)!.tasks).toHaveLength(defaultTasks + 1);
  });

  it("lets people add a group, put a task in it and estimate in hours", async () => {
    const dialog = document.querySelector(".TimelineDialog")!;
    const groupsBefore = dialog.querySelectorAll(
      "[data-testid^='timeline-group-']",
    ).length;
    fireEvent.click(
      dialog.querySelector("[data-testid='timeline-add-group']")!,
    );
    const groupInput = dialog.querySelector<HTMLInputElement>(
      `[data-testid='timeline-group-${groupsBefore}'] input`,
    )!;
    fireEvent.change(groupInput, { target: { value: "QA" } });

    const row = dialog.querySelector("[data-testid='timeline-task-0']")!;
    const groupSelect = row.querySelector<HTMLSelectElement>(
      ".TimelineDialog__group",
    )!;
    const qaOption = Array.from(groupSelect.options).find(
      (option) => option.textContent === "QA",
    )!;
    fireEvent.change(groupSelect, { target: { value: qaOption.value } });
    fireEvent.change(row.querySelector("input[type='date']")!, {
      target: { value: "2025-12-19" },
    });
    fireEvent.change(row.querySelector("input[type='number']")!, {
      target: { value: "12" },
    });
    fireEvent.change(row.querySelector(".TimelineDialog__estimate select")!, {
      target: { value: "hours" },
    });

    // 12 hours from Friday 19th = Friday + half of Monday 22nd
    expect(
      dialog.querySelector("[data-testid='timeline-ends-0']")!.textContent,
    ).toContain("22");

    const insertButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Insert"),
    )!;
    await act(async () => {
      fireEvent.click(insertButton);
    });
    const data = getTimelineData(h.elements.find((el) => getTimelineData(el)))!;
    const qa = data.groups.find((group) => group.name === "QA")!;
    expect(qa).toBeDefined();
    expect(data.tasks[0]).toMatchObject({
      groupId: qa.id,
      start: "2025-12-19",
      duration: 12,
      durationUnit: "hours",
    });
    expect(
      h.elements.some((el) => el.type === "text" && el.text === "QA"),
    ).toBe(true);
  });

  it("updates the selected timeline instead of adding a new one", async () => {
    const dialog = document.querySelector(".TimelineDialog")!;
    const insertButton = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Insert"),
    )!;
    await act(async () => {
      fireEvent.click(insertButton);
    });

    const first = h.app.scene
      .getNonDeletedElements()
      .find((el) => getTimelineData(el))!;
    API.setSelectedElements([first]);
    expect(
      findSelectedTimeline(
        h.app.scene.getNonDeletedElements(),
        h.state.selectedElementIds,
      ),
    ).not.toBeNull();

    act(() => {
      h.app.setOpenDialog({ name: "timeline" });
    });

    const editDialog = document.querySelector(".TimelineDialog")!;
    const updateButton = Array.from(editDialog.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Update timeline"),
    )!;
    expect(updateButton).toBeDefined();

    fireEvent.click(
      editDialog.querySelector("[data-testid='timeline-scale-days']")!,
    );
    await act(async () => {
      fireEvent.click(updateButton);
    });

    const timelines = h.elements.filter(
      (el) => !el.isDeleted && getTimelineData(el),
    );
    expect(timelines).toHaveLength(1);
    expect(getTimelineData(timelines[0])!.scale).toBe("days");
    expect(timelines[0].x).toBe(first.x);
    expect(timelines[0].y).toBe(first.y);
    // the old parts are gone
    expect(
      h.elements
        .filter((el) => !el.isDeleted)
        .every((el) => !el.groupIds.includes(first.groupIds[0])),
    ).toBe(true);
  });
});

describe("timeline right-click menu", () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<Excalidraw />);
  });

  const rightClick = (x: number, y: number) =>
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: x,
      clientY: y,
    });

  it("offers 'Edit timeline' and opens the dialog in edit mode", async () => {
    const elements = renderTimeline(makeData(), 0, 0, {
      today: day("2025-12-01"),
    })!;
    API.setElements(elements);

    rightClick(50, 50);
    const contextMenu = UI.queryContextMenu()!;
    expect(contextMenu).not.toBeNull();
    const item = contextMenu.querySelector<HTMLElement>(
      "[data-testid='editTimeline']",
    )!;
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Edit timeline");

    await act(async () => {
      fireEvent.click(item);
    });

    expect(h.state.openDialog).toEqual({ name: "timeline" });
    const dialog = document.querySelector(".TimelineDialog")!;
    expect(
      Array.from(dialog.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Update timeline"),
      ),
    ).toBe(true);
    // the form is filled with the timeline's own tasks
    expect(
      dialog.querySelector<HTMLInputElement>(
        "[data-testid='timeline-task-0'] .TimelineDialog__name",
      )!.value,
    ).toBe("Our second task");
  });

  it("doesn't offer 'Edit timeline' for other shapes", () => {
    const rect = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "red",
      fillStyle: "solid",
    });
    API.setElements([rect]);

    rightClick(50, 50);
    const contextMenu = UI.queryContextMenu()!;
    expect(contextMenu).not.toBeNull();
    expect(
      contextMenu.querySelector("[data-testid='editTimeline']"),
    ).toBeNull();
  });
});
