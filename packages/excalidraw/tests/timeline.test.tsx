import React from "react";

import { Excalidraw } from "../index";
import {
  createDefaultTimelineData,
  findSelectedTimeline,
  formatDay,
  getTaskProblem,
  getTimelineData,
  getTimelineRange,
  parseDay,
  renderTimeline,
  startOfWeek,
  TIMELINE_LAYOUT,
} from "../timeline";

import { API } from "./helpers/api";
import { UI } from "./helpers/ui";
import { act, fireEvent, GlobalTestState, render, waitFor } from "./test-utils";

import type { TimelineData } from "../timeline";

const { h } = window;

const day = (value: string) => parseDay(value)!;

const makeData = (overrides: Partial<TimelineData> = {}): TimelineData => ({
  scale: "weeks",
  showToday: false,
  sketchy: false,
  tasks: [
    {
      id: "t1",
      name: "Our second task",
      start: "2025-12-15",
      end: "2025-12-29",
      color: "yellow",
      tag: "Yellow",
    },
    {
      id: "t2",
      name: "Our third task",
      start: "2025-12-11",
      end: "2026-01-15",
      color: "blue",
      tag: "",
    },
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
    expect(getTaskProblem({ ...task, end: "" })).toBe("missingDates");
    expect(getTaskProblem({ ...task, end: "2025-12-01" })).toBe(
      "endBeforeStart",
    );
  });

  it("snaps the week range to Mondays and covers every date", () => {
    const range = getTimelineRange(makeData(), day("2025-12-01"))!;
    expect(formatDay(range.start)).toBe("2025-12-08");
    expect(range.start).toBe(startOfWeek(range.start));
    expect(range.end).toBe(startOfWeek(range.end));
    expect(range.end).toBeGreaterThan(day("2026-01-15"));
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
    // 15th to 29th inclusive = 15 days
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
      tasks: [
        {
          id: "t",
          name: "No dates yet",
          start: "",
          end: "",
          color: "green",
          tag: "",
        },
      ],
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
      tasks: [
        {
          id: "t",
          name: "Short",
          start: "2025-12-03",
          end: "2025-12-05",
          color: "green",
          tag: "",
        },
      ],
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
