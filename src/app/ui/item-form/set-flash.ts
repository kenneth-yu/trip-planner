import { cookies } from "next/headers";
import { FLASH_COOKIE, flashPath, type FlashKind } from "./flash";

export async function setFlash(kind: FlashKind, tripId: string): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, kind, { path: flashPath(tripId), maxAge: 60, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false });
}
