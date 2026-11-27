import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/domain/auth/next-path";
import { currentUser } from "@/server/auth/session";
import { signInModel } from "./model";
import { SignInScreen } from "./sign-in-screen";

export const metadata: Metadata = { title: "Sign in" };

const params = z.object({ next: z.string().optional(), error: z.string().optional() });

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const query = params.parse(Object.fromEntries(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))));
  if (await currentUser()) redirect(safeNextPath(query.next));
  return <SignInScreen {...signInModel(process.env, query)} />;
}
