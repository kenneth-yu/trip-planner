import { z } from "zod";
import raw from "./budgets.json";

const Budgets = z.object({
  hotPaths: z.record(z.string(), z.object({ budgetMs: z.number().positive() })),
  mcp: z.record(z.string(), z.object({ budgetMs: z.number().positive() })),
  bundle: z.record(z.string(), z.object({ budgetGzipBytes: z.number().int().positive() })),
});

export const budgets = Budgets.parse(raw);
