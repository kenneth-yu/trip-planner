import { z } from "zod";

export const FLASH_COOKIE = "trip-flash";

export const flashSchema = z.object({ kind: z.enum(["saved", "deleted"]), text: z.string().max(300).optional() });

export type Flash = z.infer<typeof flashSchema>;

export const flashCookieSchema = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      ctx.addIssue({ code: "custom", message: "Not a flash" });
      return z.NEVER;
    }
  })
  .pipe(flashSchema);
