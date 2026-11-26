import type { DeadlineKind, FlightDetails, ItemPrivate, ItemStatus, ItemType, Location, StayDetails, TransferDetails, ZonedTime } from "../types";

export interface ProposedDeadline {
  kind: DeadlineKind;
  at: ZonedTime;
  consequence: string;
  source: "parsed" | "manual";
}

export interface ProposedItem {
  type: ItemType;
  title: string;
  start: ZonedTime;
  end: ZonedTime;
  startIsEstimated: boolean;
  endIsEstimated: boolean;
  location: Location | null;
  flight?: FlightDetails;
  stay?: StayDetails;
  transfer?: TransferDetails;
  travelerIds: string[];
  private: ItemPrivate[];
  deadlines: ProposedDeadline[];
  notes: string;
  status: ItemStatus;
  problems: string[];
}

export type ImportSource = "google_calendar" | "ics" | "email" | "manual" | "assistant";

export type TimeDifference = { field: "start" | "end"; values: string[]; options: ZonedTime[] };
export type AirportDifference = { field: "fromAirport" | "toAirport"; values: string[]; options: string[] };
export type Difference = TimeDifference | AirportDifference;
