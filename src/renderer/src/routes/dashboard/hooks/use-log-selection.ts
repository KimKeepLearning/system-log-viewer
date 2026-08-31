import { useCallback, useRef, useState } from "react";

export interface RowRange {
  from: number;
  to: number;
}

/**
 * Row-level range selection, the way a file list behaves: click anchors, shift
 * click extends. It exists because the native text selection cannot reach rows
 * that the virtualizer has not mounted, so any range wider than the viewport
 * has to be tracked as indices rather than as DOM nodes.
 */
export const useLogSelection = () => {
  const anchorRef = useRef<number | null>(null);
  const [range, setRange] = useState<RowRange | null>(null);

  const selectRow = useCallback((index: number) => {
    anchorRef.current = index;
    setRange({ from: index, to: index });
  }, []);

  const selectRange = useCallback((next: RowRange) => {
    anchorRef.current = next.from;
    setRange(next);
  }, []);

  const extendTo = useCallback((index: number) => {
    const anchor = anchorRef.current ?? index;
    anchorRef.current = anchor;
    setRange({ from: Math.min(anchor, index), to: Math.max(anchor, index) });
  }, []);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setRange(null);
  }, []);

  const isSelected = useCallback(
    (index: number) => range !== null && index >= range.from && index <= range.to,
    [range]
  );

  return {
    range,
    selectedCount: range ? range.to - range.from + 1 : 0,
    selectRow,
    selectRange,
    extendTo,
    clear,
    isSelected
  };
};
