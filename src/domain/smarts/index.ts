import type { TripView } from "../visibility/project";
import { riskyConnections } from "./connections";
import type { SmartCheck } from "./types";
import { wrongTime } from "./wrong-time";

export type { SmartCheck, SmartCheckKind, SmartFix } from "./types";
export { riskyConnections } from "./connections";
export { wrongTime } from "./wrong-time";

export function smartChecks(view: TripView): SmartCheck[] {
  return [...riskyConnections(view), ...wrongTime(view)];
}
