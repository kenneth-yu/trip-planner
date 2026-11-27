import type { FormEntries } from "@/domain/import/item-form";

export interface FormState {
  errors: Record<string, string>;
  message: string | null;
  values: FormEntries;
}

export const emptyFormState: FormState = { errors: {}, message: null, values: [] };

export type PlaceHint =
  | { status: "empty" }
  | { status: "found"; line: string | null; city: string; zone: string; warning: string | null }
  | { status: "missing"; message: string }
  | { status: "limited"; message: string };

export type HintKind = "airport" | "place";
