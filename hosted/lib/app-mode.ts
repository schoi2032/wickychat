export type AppMode = "local" | "supabase" | "setup" | "hosted";
export function appMode(): AppMode { return "hosted"; }
