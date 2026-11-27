import { currentUser } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { listTrips } from "@/server/services/trip-service";
import { signOutAction } from "./sign-out/actions";
import { signInModel } from "./sign-in/model";
import { SignInScreen } from "./sign-in/sign-in-screen";
import { TripList } from "./sign-in/trip-list";

export default async function Home() {
  const user = await currentUser();
  if (!user) return <SignInScreen {...signInModel(process.env, {})} />;
  const trips = await listTrips(await requestContext(), user.id);
  return <TripList trips={trips} signOut={signOutAction} />;
}
