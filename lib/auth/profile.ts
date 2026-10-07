import type { SupabaseClient } from "@supabase/supabase-js";

export type UserProfile = {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
};

export async function getProfileForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, phone, full_name")
    .eq("id", userId)
    .maybeSingle();
  return error ? null : data;
}
