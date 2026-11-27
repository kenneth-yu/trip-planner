import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { z } from "zod";

export type SealPurpose = "item_private" | "activity" | "import";

const KEY_ID = "k1";

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

function dataKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new SealError("DATA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new SealError("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  if (key.every((byte) => byte === 0)) throw new SealError("DATA_ENCRYPTION_KEY must not be all zeros. Generate one with: openssl rand -base64 32");
  return key;
}

export function assertDataKey(): void {
  dataKey();
}

function context(purpose: SealPurpose, rowId: string): Buffer {
  return Buffer.from(`${purpose}:${rowId}`, "utf8");
}

export function sealJson(value: unknown, purpose: SealPurpose, rowId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  cipher.setAAD(context(purpose, rowId));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [KEY_ID, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function openText(sealed: string, purpose: SealPurpose, rowId: string): string {
  const [keyId, iv, tag, body, ...extra] = sealed.split(".");
  if (keyId !== KEY_ID || !iv || !tag || body === undefined || extra.length) {
    throw new SealError("Stored data is not in a sealed format this version can read.");
  }
  const key = dataKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(context(purpose, rowId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SealError("Stored data could not be opened. The key or the row does not match.");
  }
}

export function openJson<T>(sealed: string, schema: z.ZodType<T>, purpose: SealPurpose, rowId: string): T {
  const parsed = schema.safeParse(JSON.parse(openText(sealed, purpose, rowId)));
  if (!parsed.success) throw new SealError("Stored data opened but is not in the expected shape.");
  return parsed.data;
}
