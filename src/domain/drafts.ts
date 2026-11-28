import type { Deadline, ItemPrivate } from "./types";

export function keptWhileNotBooked(rows: ItemPrivate[]): ItemPrivate[] {
  return rows.flatMap((row) => {
    const kept: ItemPrivate = { travelerId: row.travelerId, phone: row.phone, notes: row.notes };
    return kept.phone || kept.notes ? [kept] : [];
  });
}

export function withoutBookedOnly<T extends { private: ItemPrivate[]; deadlines: Deadline[] }>(item: T): T {
  return { ...item, private: keptWhileNotBooked(item.private), deadlines: [] };
}

export function hasBookedOnly(rows: ItemPrivate[]): boolean {
  return rows.some((r) => r.confirmationCode || r.bookingReference || r.price || r.seat || r.bookingSite);
}
