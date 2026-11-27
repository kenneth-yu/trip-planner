import type { ServiceContext } from "@/server/services/context";
import { acceptInvite, InviteProblem } from "@/server/services/sharing-service";
import { noticeValue } from "./notice";

export interface Claim {
  path: string;
  notice: string | null;
}

export async function claimInvite(ctx: ServiceContext, token: string, user: { id: string; name: string }): Promise<Claim> {
  try {
    const accepted = await acceptInvite(ctx, token, user);
    return { path: `/trips/${accepted.tripId}`, notice: noticeValue(accepted) };
  } catch (e) {
    if (!(e instanceof InviteProblem)) throw e;
    return { path: `/invite/problem/${e.problem}`, notice: null };
  }
}
