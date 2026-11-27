import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { present } from "@/testing/present";
import { openJson, SealError, sealJson } from "./sealed";

const schema = z.object({ confirmationCode: z.string(), seat: z.string() });
const value = { confirmationCode: "PLACEHOLDER_A", seat: "30K" };
const rowId = "6f1c1b0e-5f0e-4a38-9a42-0d6f3f6b7a11";

function parts(sealed: string) {
  const [id, iv, tag, body] = sealed.split(".");
  return { id: present(id), iv: present(iv), tag: present(tag), body: present(body) };
}

function flipFirstByte(base64url: string): string {
  const bytes = Buffer.from(base64url, "base64url");
  bytes.writeUInt8(bytes.readUInt8(0) ^ 1, 0);
  return bytes.toString("base64url");
}

afterEach(() => vi.unstubAllEnvs());

describe("sealed json", () => {
  it("round trips and hides the plaintext", () => {
    const sealed = sealJson(value, "item_private", rowId);
    const p = parts(sealed);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    expect(sealed).toMatch(/^k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(Buffer.from(p.iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(p.tag, "base64url")).toHaveLength(16);
    const body = Buffer.from(p.body, "base64url");
    expect(body).toHaveLength(plaintext.length);
    expect(body.equals(plaintext)).toBe(false);
    expect(sealed).not.toContain("PLACEHOLDER_A");
    expect(openJson(sealed, schema, "item_private", rowId)).toEqual(value);
  });

  it("uses a fresh nonce every time", () => {
    expect(sealJson(value, "item_private", rowId)).not.toBe(sealJson(value, "item_private", rowId));
  });

  it("fails when the body or tag is tampered with", () => {
    const p = parts(sealJson(value, "item_private", rowId));
    const withBody = [p.id, p.iv, p.tag, flipFirstByte(p.body)].join(".");
    const withTag = [p.id, p.iv, flipFirstByte(p.tag), p.body].join(".");
    expect(() => openJson(withBody, schema, "item_private", rowId)).toThrow(SealError);
    expect(() => openJson(withTag, schema, "item_private", rowId)).toThrow(SealError);
  });

  it("fails for another purpose or another row id", () => {
    const sealed = sealJson(value, "item_private", rowId);
    expect(() => openJson(sealed, schema, "import", rowId)).toThrow(SealError);
    expect(() => openJson(sealed, schema, "item_private", "7f1c1b0e-5f0e-4a38-9a42-0d6f3f6b7a11")).toThrow(SealError);
  });

  it("fails for an unknown key id or a malformed envelope", () => {
    const sealed = sealJson(value, "item_private", rowId);
    expect(() => openJson(sealed.replace("k1.", "k9."), schema, "item_private", rowId)).toThrow(/sealed format/);
    expect(() => openJson("not sealed", schema, "item_private", rowId)).toThrow(/sealed format/);
    expect(() => openJson(`${sealed}.extra`, schema, "item_private", rowId)).toThrow(/sealed format/);
  });

  it("fails when the opened data has the wrong shape", () => {
    const sealed = sealJson({ seat: 1 }, "item_private", rowId);
    expect(() => openJson(sealed, schema, "item_private", rowId)).toThrow(/expected shape/);
  });

  it("does not put stored data or the purpose in error messages", () => {
    const wrongShape = sealJson({ seat: "30K", confirmationCode: 1 }, "item_private", rowId);
    const wrongPurpose = sealJson(value, "item_private", rowId);
    const messages = [
      () => openJson(wrongPurpose, schema, "import", rowId),
      () => openJson(wrongShape, schema, "item_private", rowId),
    ].map((attempt) => {
      try {
        attempt();
        return "";
      } catch (error) {
        return String(error);
      }
    });
    for (const message of messages) {
      expect(message).not.toBe("");
      expect(message).not.toMatch(/PLACEHOLDER|30K|item_private|import|6f1c1b0e/);
    }
  });

  it("fails with the setup message when the key is missing", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", "");
    expect(() => sealJson(value, "item_private", rowId)).toThrow(/DATA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32/);
  });

  it("rejects a key that is not 32 bytes", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(16, 1).toString("base64"));
    expect(() => sealJson(value, "item_private", rowId)).toThrow(/32 bytes/);
  });

  it("rejects an all-zero key", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 0).toString("base64"));
    expect(() => sealJson(value, "item_private", rowId)).toThrow(/all zeros/);
  });

  it("cannot open data sealed under a different key", () => {
    const sealed = sealJson(value, "item_private", rowId);
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => openJson(sealed, schema, "item_private", rowId)).toThrow(SealError);
  });
});
