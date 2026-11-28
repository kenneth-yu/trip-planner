export interface UndoState {
  parts: { text: string; href?: string }[];
}

export const noUndo: UndoState = { parts: [] };
