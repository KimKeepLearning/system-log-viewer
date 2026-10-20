import { IUserLog } from "@renderer/lib/typings";

export interface ExtendedLog extends IUserLog {
  sourceFile: string;
  count: number;
  id: string;
  duplicates: IUserLog[];
  /** The parsed line this row was made from, for finding it again by identity. */
  raw: IUserLog;
}
