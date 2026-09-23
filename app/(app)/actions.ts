"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
