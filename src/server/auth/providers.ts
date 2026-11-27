export type ProviderId = "google" | "apple" | "email";

export type Env = Record<string, string | undefined>;

export function isLocalDevelopment(env: Env): boolean {
  return env.DEV_SIGN_IN === "1" && env.NODE_ENV !== "production";
}

export function enabledProviders(env: Env): ProviderId[] {
  const providers: ProviderId[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push("google");
  if (env.AUTH_APPLE_ID && env.AUTH_APPLE_SECRET) providers.push("apple");
  if ((env.EMAIL_API_KEY && env.EMAIL_FROM) || isLocalDevelopment(env)) providers.push("email");
  return providers;
}
