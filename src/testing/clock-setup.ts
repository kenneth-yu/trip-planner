import { beforeEach } from "vitest";
import { freezeClock } from "./clock";

freezeClock();
beforeEach(freezeClock);
