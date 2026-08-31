import { useMemo } from "react";
import { buildMatcher, ParsedQuery } from "@renderer/lib/log-query";
import { ExtendedLog } from "../types";

/** Indices of the rows a query matches, for stepping through them in place. */
export const useLogSearch = (allLogs: ExtendedLog[], parsed: ParsedQuery): number[] =>
  useMemo(() => {
    if (parsed.isEmpty) return [];

    const matches = buildMatcher(parsed);
    const indices: number[] = [];
    for (let index = 0; index < allLogs.length; index++) {
      if (matches(allLogs[index])) indices.push(index);
    }
    return indices;
  }, [allLogs, parsed]);
