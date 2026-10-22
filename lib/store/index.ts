import "server-only";

import { ORG_ID } from "../config";
import { MemoryStore } from "./memory";
import { SupabaseStore, supabaseServer } from "./supabase";
import type { Store } from "./types";

export const DEMO = process.env.FACT_DEMO === "1";

/** The store for this request: Supabase with the signed-in user's session, or the demo store. */
export async function getStore(): Promise<Store> {
  if (DEMO) return new MemoryStore();
  return new SupabaseStore(await supabaseServer(), ORG_ID);
}

export type { Store } from "./types";
