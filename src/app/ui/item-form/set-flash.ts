import { cookies } from "next/headers";
import { FLASH_COOKIE, type Flash } from "./flash";

export async function setFlash(flash: Flash): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, JSON.stringify(flash), { path: "/", maxAge: 60, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false });
}
