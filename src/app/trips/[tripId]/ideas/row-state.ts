import type { IdeaState } from "./actions";

export function closesRow(state: IdeaState): boolean {
  return state.error === null && state.status !== null;
}
