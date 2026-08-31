import { useCallback } from "react";
import { buildLogText } from "@renderer/lib/log-utils";
import { ExtendedLog } from "../types";
import { RowRange } from "./use-log-selection";

const closestWithAttr = (node: Node | null | undefined, attr: string): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>(`[${attr}]`) ?? null;
};

/**
 * Maps a text selection onto the rows it covers. Returns "native" when the
 * selection sits inside a single field, where the browser's own copy is right.
 */
export const rangeFromSelection = (selection: Selection): RowRange | "native" | null => {
  const startRow = closestWithAttr(selection.anchorNode, "data-log-index");
  const endRow = closestWithAttr(selection.focusNode, "data-log-index");
  if (!startRow || !endRow) return null;

  const startField = closestWithAttr(selection.anchorNode, "data-log-field");
  const endField = closestWithAttr(selection.focusNode, "data-log-field");

  // Picking out part of one field (say, a pid inside a message) is exactly what
  // the browser already copies correctly. Leave it alone.
  if (startRow === endRow && startField && startField === endField) return "native";

  const anchorIndex = Number(startRow.dataset.logIndex);
  const focusIndex = Number(endRow.dataset.logIndex);
  if (Number.isNaN(anchorIndex) || Number.isNaN(focusIndex)) return null;

  return {
    from: Math.min(anchorIndex, focusIndex),
    to: Math.max(anchorIndex, focusIndex)
  };
};

/**
 * The rendered rows are a poor copy source: fields are separate flex items that
 * serialize onto their own lines, section headers and the `xN` badge sit inside
 * the scrolled content, and folded duplicates are not in the DOM at all. So we
 * only use the selection to work out which rows it covers, then rebuild the
 * text from the log data itself.
 *
 * With no text selection, the row range from `useLogSelection` is copied
 * instead — that is the only path that can reach rows outside the viewport.
 */
export const useCopyLogs = (logs: ExtendedLog[], rowRange: RowRange | null) => {
  return useCallback(
    (event: React.ClipboardEvent) => {
      const selection = window.getSelection();

      let range: RowRange | null = rowRange;
      if (selection && !selection.isCollapsed) {
        const fromSelection = rangeFromSelection(selection);
        if (fromSelection === "native" || fromSelection === null) return;
        range = fromSelection;
      }

      if (!range) return;

      const selected = logs.slice(range.from, range.to + 1);
      if (selected.length === 0) return;

      event.clipboardData.setData("text/plain", buildLogText(selected));
      event.preventDefault();
    },
    [logs, rowRange]
  );
};
