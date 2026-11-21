import clsx from "clsx";
import React, { useEffect, useMemo, useState } from "react";

import { COLOR_PALETTE, EDITOR_LS_KEYS, randomId } from "@excalidraw/common";

import { newElementWith } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import { trackEvent } from "../analytics";
import { EditorLocalStorage } from "../data/EditorLocalStorage";
import { t } from "../i18n";
import { exportScene } from "../scene/export";
import {
  TIMELINE_COLORS,
  createDefaultTimelineData,
  findSelectedTimeline,
  formatDay,
  getTaskProblem,
  getTimelineRange,
  parseDay,
  renderTimeline,
  toDayNumber,
} from "../timeline";

import { useUIAppState } from "../context/ui-appState";
import { useCallbackRefState } from "../hooks/useCallbackRefState";

import { useApp } from "./App";
import { CheckboxItem } from "./CheckboxItem";
import { Dialog } from "./Dialog";
import { FilledButton } from "./FilledButton";
import { PlusIcon, TrashIcon } from "./icons";

import "./TimelineDialog.scss";

import type { TimelineLabels } from "../timeline";
import type {
  TimelineColor,
  TimelineData,
  TimelineMilestone,
  TimelineTask,
} from "../timeline";
import type { JSONValue } from "../types";

const getLabels = (): TimelineLabels => ({
  weeks: t("timelineDialog.weeks"),
  days: t("timelineDialog.days"),
  taskCount: (count) =>
    count === 1
      ? t("timelineDialog.taskCount_one", { count })
      : t("timelineDialog.taskCount_other", { count }),
});

/** loads what the user typed last time, so closing the dialog loses nothing */
const loadSavedData = (): TimelineData | null => {
  const saved = EditorLocalStorage.get<JSONValue>(EDITOR_LS_KEYS.TIMELINE);
  if (
    saved &&
    typeof saved === "object" &&
    !Array.isArray(saved) &&
    Array.isArray((saved as any).tasks) &&
    Array.isArray((saved as any).milestones)
  ) {
    return saved as unknown as TimelineData;
  }
  return null;
};

export const TimelineDialog = ({ onClose }: { onClose: () => void }) => {
  const app = useApp();
  const { theme, selectedElementIds } = useUIAppState();
  const today = useMemo(() => toDayNumber(new Date()), []);

  // if a timeline is selected, edit it instead of making a new one
  const [editing] = useState(() =>
    findSelectedTimeline(app.scene.getNonDeletedElements(), selectedElementIds),
  );

  const [data, setData] = useState<TimelineData>(
    () => editing?.data ?? loadSavedData() ?? createDefaultTimelineData(today),
  );

  useEffect(() => {
    if (!editing) {
      EditorLocalStorage.set(
        EDITOR_LS_KEYS.TIMELINE,
        data as unknown as JSONValue,
      );
    }
  }, [data, editing]);

  const isTooLong = getTimelineRange(data, today) === null;

  // preview ---------------------------------------------------------------

  // the dialog mounts its content a moment later, so track the node in state
  const [previewNode, previewRef] = useCallbackRefState<HTMLDivElement>();
  useEffect(() => {
    const node = previewNode;
    if (!node) {
      return;
    }
    const elements = renderTimeline(data, 0, 0, {
      today,
      renderEnvironment: app.renderEnvironment,
      labels: getLabels(),
    });
    if (!elements) {
      node.replaceChildren();
      return;
    }
    let cancelled = false;
    (async () => {
      const svg = await exportScene({
        type: "svg",
        data: { elements, files: null },
        config: {
          skipInliningFonts: true,
          theme,
          canvasBackgroundColor: false,
          environment: app.renderEnvironment,
          padding: 8,
        },
      });
      if (cancelled) {
        return;
      }
      svg.querySelector(".style-fonts")?.remove();
      node.replaceChildren(svg);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, theme, today, app.renderEnvironment, previewNode]);

  // editing helpers ---------------------------------------------------------

  const updateTask = (id: string, patch: Partial<TimelineTask>) =>
    setData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === id ? { ...task, ...patch } : task,
      ),
    }));

  const updateMilestone = (id: string, patch: Partial<TimelineMilestone>) =>
    setData((prev) => ({
      ...prev,
      milestones: prev.milestones.map((milestone) =>
        milestone.id === id ? { ...milestone, ...patch } : milestone,
      ),
    }));

  const addTask = () =>
    setData((prev) => {
      // start the new task where the last one ends, so it's easy to chain
      const last = prev.tasks[prev.tasks.length - 1];
      const lastEnd = last ? parseDay(last.end) : null;
      const start = lastEnd !== null ? lastEnd + 1 : today;
      const usedColors = new Set(prev.tasks.map((task) => task.color));
      const color =
        TIMELINE_COLORS.find((c) => !usedColors.has(c)) ??
        TIMELINE_COLORS[prev.tasks.length % TIMELINE_COLORS.length];
      return {
        ...prev,
        tasks: [
          ...prev.tasks,
          {
            id: randomId(),
            name: "",
            start: formatDay(start),
            end: formatDay(start + 6),
            color,
            tag: "",
          },
        ],
      };
    });

  const addMilestone = () =>
    setData((prev) => {
      const days = prev.tasks
        .map((task) => parseDay(task.end))
        .filter((day): day is number => day !== null);
      const date = days.length ? Math.max(...days) : today;
      return {
        ...prev,
        milestones: [
          ...prev.milestones,
          { id: randomId(), name: "", date: formatDay(date) },
        ],
      };
    });

  // insert ----------------------------------------------------------------

  const handleInsert = () => {
    const labels = getLabels();
    if (editing) {
      const { element: old, groupId } = editing;
      const elements = renderTimeline(data, old.x, old.y, {
        today,
        renderEnvironment: app.renderEnvironment,
        labels,
      });
      if (!elements) {
        return;
      }
      const current = app.scene.getElementsIncludingDeleted();
      const removed = current.map((element) =>
        element.id === old.id || (groupId && element.groupIds.includes(groupId))
          ? newElementWith(element, { isDeleted: true })
          : element,
      );
      const newGroupId = elements[0].groupIds[0];
      app.updateScene({
        elements: [...removed, ...elements],
        appState: {
          selectedElementIds: Object.fromEntries(
            elements.map((element) => [element.id, true as const]),
          ),
          selectedGroupIds: newGroupId ? { [newGroupId]: true } : {},
          editingGroupId: null,
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      trackEvent("timeline", "update");
    } else {
      const elements = renderTimeline(data, 0, 0, {
        today,
        renderEnvironment: app.renderEnvironment,
        labels,
      });
      if (!elements) {
        return;
      }
      app.addElementsFromPasteOrLibrary({
        elements,
        files: null,
        position: "center",
        fit: "scale-down",
      });
      trackEvent("timeline", "insert");
    }
    onClose();
    app.focusContainer();
  };

  return (
    <Dialog
      size="wide"
      onCloseRequest={onClose}
      title={t("timelineDialog.title")}
      className="TimelineDialog"
      autofocus={false}
    >
      <p className="TimelineDialog__intro">
        {editing ? t("timelineDialog.editHint") : t("timelineDialog.intro")}
      </p>

      <div className="TimelineDialog__options">
        <div
          className="TimelineDialog__scale"
          role="radiogroup"
          aria-label={t("timelineDialog.scale")}
        >
          {(["weeks", "days"] as const).map((scale) => (
            <button
              key={scale}
              type="button"
              role="radio"
              aria-checked={data.scale === scale}
              className={clsx({ active: data.scale === scale })}
              onClick={() => setData((prev) => ({ ...prev, scale }))}
              data-testid={`timeline-scale-${scale}`}
            >
              {t(`timelineDialog.${scale}`)}
            </button>
          ))}
        </div>
        <CheckboxItem
          checked={data.showToday}
          onChange={(showToday) => setData((prev) => ({ ...prev, showToday }))}
        >
          {t("timelineDialog.showToday")}
        </CheckboxItem>
        <CheckboxItem
          checked={data.sketchy}
          onChange={(sketchy) => setData((prev) => ({ ...prev, sketchy }))}
        >
          {t("timelineDialog.sketchy")}
        </CheckboxItem>
      </div>

      <section className="TimelineDialog__section">
        <h3>{t("timelineDialog.tasks")}</h3>
        <div className="TimelineDialog__rows">
          {data.tasks.map((task, index) => {
            const problem = getTaskProblem(task);
            return (
              <div
                key={task.id}
                className={clsx("TimelineDialog__row", {
                  "has-error": problem,
                })}
                data-testid={`timeline-task-${index}`}
              >
                <ColorSelect
                  value={task.color}
                  onChange={(color) => updateTask(task.id, { color })}
                />
                <input
                  type="text"
                  className="TimelineDialog__name"
                  placeholder={t("timelineDialog.taskName")}
                  aria-label={t("timelineDialog.taskName")}
                  value={task.name}
                  onChange={(event) =>
                    updateTask(task.id, { name: event.target.value })
                  }
                />
                <input
                  type="date"
                  aria-label={t("timelineDialog.start")}
                  title={t("timelineDialog.start")}
                  value={task.start}
                  onChange={(event) =>
                    updateTask(task.id, { start: event.target.value })
                  }
                />
                <input
                  type="date"
                  aria-label={t("timelineDialog.end")}
                  title={t("timelineDialog.end")}
                  value={task.end}
                  onChange={(event) =>
                    updateTask(task.id, { end: event.target.value })
                  }
                />
                <input
                  type="text"
                  className="TimelineDialog__tag"
                  placeholder={t("timelineDialog.tag")}
                  aria-label={t("timelineDialog.tag")}
                  value={task.tag}
                  onChange={(event) =>
                    updateTask(task.id, { tag: event.target.value })
                  }
                />
                <RemoveButton
                  onClick={() =>
                    setData((prev) => ({
                      ...prev,
                      tasks: prev.tasks.filter((other) => other.id !== task.id),
                    }))
                  }
                />
                {problem && (
                  <div className="TimelineDialog__error">
                    {t(`timelineDialog.${problem}`)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="TimelineDialog__add"
          onClick={addTask}
          data-testid="timeline-add-task"
        >
          {PlusIcon} {t("timelineDialog.addTask")}
        </button>
      </section>

      <section className="TimelineDialog__section">
        <h3>{t("timelineDialog.milestones")}</h3>
        <div className="TimelineDialog__rows">
          {data.milestones.map((milestone, index) => (
            <div
              key={milestone.id}
              className="TimelineDialog__row TimelineDialog__row--milestone"
              data-testid={`timeline-milestone-${index}`}
            >
              <span className="TimelineDialog__diamond" aria-hidden="true" />
              <input
                type="text"
                className="TimelineDialog__name"
                placeholder={t("timelineDialog.milestoneName")}
                aria-label={t("timelineDialog.milestoneName")}
                value={milestone.name}
                onChange={(event) =>
                  updateMilestone(milestone.id, { name: event.target.value })
                }
              />
              <input
                type="date"
                aria-label={t("timelineDialog.date")}
                title={t("timelineDialog.date")}
                value={milestone.date}
                onChange={(event) =>
                  updateMilestone(milestone.id, { date: event.target.value })
                }
              />
              <RemoveButton
                onClick={() =>
                  setData((prev) => ({
                    ...prev,
                    milestones: prev.milestones.filter(
                      (other) => other.id !== milestone.id,
                    ),
                  }))
                }
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="TimelineDialog__add"
          onClick={addMilestone}
          data-testid="timeline-add-milestone"
        >
          {PlusIcon} {t("timelineDialog.addMilestone")}
        </button>
      </section>

      <section className="TimelineDialog__section">
        <h3>{t("timelineDialog.preview")}</h3>
        {isTooLong ? (
          <div className="TimelineDialog__error">
            {t("timelineDialog.tooLong")}
          </div>
        ) : (
          <div className="TimelineDialog__preview" ref={previewRef} />
        )}
      </section>

      <div className="TimelineDialog__footer">
        <FilledButton
          size="large"
          label={
            editing ? t("timelineDialog.update") : t("timelineDialog.insert")
          }
          onClick={handleInsert}
          disabled={isTooLong}
        />
      </div>
    </Dialog>
  );
};

const RemoveButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    className="TimelineDialog__remove"
    onClick={onClick}
    aria-label={t("timelineDialog.remove")}
    title={t("timelineDialog.remove")}
  >
    {TrashIcon}
  </button>
);

const ColorSelect = ({
  value,
  onChange,
}: {
  value: TimelineColor;
  onChange: (color: TimelineColor) => void;
}) => (
  <label
    className="TimelineDialog__color"
    title={t("timelineDialog.color")}
    style={{
      backgroundColor: COLOR_PALETTE[value][1],
      borderColor: COLOR_PALETTE[value][4],
    }}
  >
    <select
      aria-label={t("timelineDialog.color")}
      value={value}
      onChange={(event) => onChange(event.target.value as TimelineColor)}
    >
      {TIMELINE_COLORS.map((color) => (
        <option key={color} value={color}>
          {color}
        </option>
      ))}
    </select>
  </label>
);
