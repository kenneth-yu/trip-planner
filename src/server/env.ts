import { z } from "zod";

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

export type Deployment = "production" | "preview" | "local";

export interface ServerEnv {
  deployment: Deployment;
  appUrl: string;
  databaseUrl: string | undefined;
  devSignIn: boolean;
}

const LOCAL_APP_URL = "http://localhost:3000";

const present = z.string().min(1);
const secret = present.min(32);

export function isReviewServer(source: Record<string, string | undefined>): boolean {
  return source.REVIEW_SERVER === "1" && !source.VERCEL && !source.VERCEL_ENV && !source.DATABASE_URL;
}

export function deploymentOf(source: Record<string, string | undefined>): Deployment {
  if (isReviewServer(source)) return "local";
  if (source.VERCEL_ENV === "production") return "production";
  if (source.VERCEL_ENV === "preview") return "preview";
  if (source.NODE_ENV === "production") return "production";
  return "local";
}

export function appUrlRequired(source: Record<string, string | undefined>): boolean {
  const deployment = deploymentOf(source);
  if (deployment === "production") return true;
  return deployment === "preview" && Boolean(source.EMAIL_API_KEY && source.EMAIL_FROM);
}

function problems(source: Record<string, string | undefined>, deployment: Deployment): string[] {
  const found: string[] = [];
  const need = (name: string, schema: z.ZodType, hint: string) => {
    if (!schema.safeParse(source[name]).success) found.push(`${name} ${hint}`);
  };

  if (deployment !== "local") {
    need("AUTH_SECRET", present, "is not set. Generate one with: openssl rand -base64 32");
    need("SESSION_SECRET", secret, "must be set to at least 32 characters. Generate one with: openssl rand -hex 32");
    need("TOKEN_ENCRYPTION_KEY", present, "is not set. Generate one with: openssl rand -base64 32");
    need("DATA_ENCRYPTION_KEY", present, "is not set. Generate one with: openssl rand -base64 32");
  }
  if (appUrlRequired(source)) {
    need("APP_URL", z.url({ protocol: /^https$/ }), "must be set to the https address of the site on a production deployment, or on a preview that sends email links");
  }
  if (deployment !== "local") {
    need("DATABASE_URL", present, "is not set. A production or preview deployment never runs on the embedded database");
  }
  if (source.REVIEW_SERVER === "1" && !isReviewServer(source)) {
    found.push("REVIEW_SERVER=1 is set on a deployment or with a database url. Remove REVIEW_SERVER; it is only for the local review server");
  }
  if (source.DEV_SIGN_IN === "1" && deployment === "production") {
    found.push("DEV_SIGN_IN=1 is set on a production deployment. Remove DEV_SIGN_IN from the production environment variables");
  }
  return found;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const deployment = deploymentOf(source);
  const found = problems(source, deployment);
  if (found.length) throw new SetupError(`The server environment is not ready:\n${found.map((line) => `- ${line}`).join("\n")}`);
  return {
    deployment,
    appUrl: source.APP_URL || LOCAL_APP_URL,
    databaseUrl: source.DATABASE_URL || undefined,
    devSignIn: source.DEV_SIGN_IN === "1",
  };
}

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isRemoteDatabase(url: string | undefined): boolean {
  if (!url) return false;
  const parsed = URL.parse(url);
  return !parsed || !LOCAL_DATABASE_HOSTS.has(parsed.hostname);
}

export function looksLikeProduction(source: Record<string, string | undefined>): boolean {
  return source.VERCEL_ENV === "production" || source.NODE_ENV === "production" || isRemoteDatabase(source.DATABASE_URL);
}

export function serverEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
