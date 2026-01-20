import { IUserLog } from "@renderer/lib/typings";

export interface ExtendedLog extends IUserLog {
  sourceFile: string;
  count: number;
  id: string;
  duplicates: IUserLog[];
}
