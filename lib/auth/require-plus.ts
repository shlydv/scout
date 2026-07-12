import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getProfileForUser, type UserProfile } from "@/lib/auth/profile";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";
import { adminClient } from "@/lib/supabase/admin";

export type AuthedUser = {
  user: User;
  profile: UserProfile;
};

export async function requireAuthedUser(
  req: NextRequest | Request,
): Promise<AuthedUser | NextResponse> {
  const client = supabaseFromBearer(req.headers.get("authorization"));
  if (!client) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile =
    (await getProfileForUser(client, data.user.id)) ??
    (await getProfileForUser(adminClient(), data.user.id));
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  return { user: data.user, profile };
}

export async function requirePlusUser(
  req: NextRequest | Request,
): Promise<AuthedUser | NextResponse> {
  const result = await requireAuthedUser(req);
  if (result instanceof NextResponse) return result;
  const unlimited = (process.env.UNLIMITED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = (result.profile.email ?? result.user.email ?? "").toLowerCase();
  if (result.profile.plan === "plus" || unlimited.includes(email)) return result;
  return NextResponse.json(
    {
      error: "Scout Plus required",
      code: "plus_required",
    },
    { status: 402 },
  );
}

export function isPlusResponse(value: AuthedUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
