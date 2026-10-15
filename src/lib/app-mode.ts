export type AppMode = "local" | "supabase" | "setup";

export function appMode(): AppMode {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    return "supabase";
  return process.env.WICKY_LOCAL_MODE === "1" ? "local" : "setup";
}
