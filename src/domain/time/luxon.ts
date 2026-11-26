import { DateTime, Info, Settings } from "luxon";

Settings.throwOnInvalid = true;

declare module "luxon" {
  interface TSSettings {
    throwOnInvalid: true;
  }
}

export { DateTime, Info };
