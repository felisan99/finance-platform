"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseMemoryStore } from "@/lib/assistant/memory-store";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";

const idSchema = z.uuid();

/** Olvidar un recuerdo del asistente (RLS: solo los propios). */
export async function forgetMemory(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  try {
    await supabaseMemoryStore(supabase, user.id).remove(id.data);
  } catch (error) {
    console.error("[assistant] olvidar", describeError(error));
  }
  revalidatePath("/more/assistant");
}
