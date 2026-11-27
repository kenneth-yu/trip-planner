import { getDb } from "../src/server/db/client";
import { seedEverything } from "../src/server/seed";
import { defaultContext } from "../src/server/services/context";
import { createAssistantToken } from "../src/server/services/assistant-service";
import { TRIP_ID, USERS } from "../src/fixtures/december-trip";

const db = await getDb();
await seedEverything(db);
const ctx = defaultContext(db, { onTripChanged: () => undefined }, {});
const { token } = await createAssistantToken(ctx, USERS.kenny.id, { label: "Performance run", tripId: TRIP_ID, scope: "read" });
process.stdout.write(`${token}\n`);
process.exit(0);
