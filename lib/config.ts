/**
 * Where MATO Info lives. These are public values (the publishable key only works through the
 * database's row-level security), so they are defaults here; environment variables override them.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bjzufmvwldoltpitkrvx.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_H25QqhHqkFfRMvZSmNafLg_EYeSzWiM";
/** Mato Vending in MATO Info. */
export const ORG_ID = process.env.FACT_ORG_ID || "042073c9-3f8a-4da7-9a78-11d28da40ab5";
