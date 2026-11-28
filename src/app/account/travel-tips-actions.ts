"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { saveTipPreferences, TipPreferencesInput } from "@/server/services/preference-service";
import { TIP_KINDS } from "@/domain/smarts/kinds";

export interface TravelTipsState {
  status: "idle" | "saved" | "failed";
}

const Form = z.object({ tipsOn: z.boolean(), shown: z.array(z.string()) });

export async function saveTravelTipsAction(_prev: TravelTipsState, form: FormData): Promise<TravelTipsState> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const parsed = Form.safeParse({ tipsOn: form.get("tipsOn") === "on", shown: form.getAll("kind").filter((v): v is string => typeof v === "string") });
  if (!parsed.success) return { status: "failed" };
  const input = TipPreferencesInput.safeParse({ tipsOn: parsed.data.tipsOn, kindsOff: TIP_KINDS.filter((k) => !parsed.data.shown.includes(k)) });
  if (!input.success) return { status: "failed" };
  await saveTipPreferences(await requestContext(), user.id, input.data);
  revalidatePath("/", "layout");
  return { status: "saved" };
}
