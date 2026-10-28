"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConversation } from "@/lib/assistant/conversation-store";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";

/** Empieza una conversación nueva: la anterior queda guardada, pero el asistente ya no la lee. */
export async function startNewConversation(): Promise<void> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");
  try {
    await createConversation(supabase, user.id);
  } catch (error) {
    console.error("[assistant] nueva conversación", describeError(error));
  }
  revalidatePath("/assistant");
}
