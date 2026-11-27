import NextAuth from "next-auth";
import { getDb } from "../db/client";
import { buildAuthConfig } from "./config";
import { emailSenderFromEnv } from "./email";
import { enabledProviders } from "./providers";

export const { handlers, signIn, signOut } = NextAuth(async () => {
  const sender = enabledProviders(process.env).includes("email") ? emailSenderFromEnv(process.env) : null;
  return buildAuthConfig({ db: await getDb(), env: process.env, sender });
});
