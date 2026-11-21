import { CaptureUpdateAction } from "@excalidraw/element";

import { timelineIcon } from "../components/icons";
import { findSelectedTimeline } from "../timeline";

import { register } from "./register";

/**
 * Opens the Timeline dialog for the selected timeline, so its tasks and
 * dates can be changed. Shown in the right-click menu of a timeline.
 */
export const actionEditTimeline = register({
  name: "editTimeline",
  label: "labels.editTimeline",
  icon: timelineIcon,
  viewMode: false,
  trackEvent: { category: "element" },
  keywords: ["timeline", "gantt", "edit"],
  perform(elements, appState) {
    return {
      appState: {
        ...appState,
        openDialog: { name: "timeline" },
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  predicate: (elements, appState, _, app) =>
    !appState.viewModeEnabled &&
    findSelectedTimeline(
      app.scene.getNonDeletedElements(),
      appState.selectedElementIds,
    ) !== null,
});
