import { z } from "zod";

export const IMPORTANCE = [
  "important",
  "slightly_important",
  "unimportant",
] as const;
export const REACTIONS = ["👍", "❤️", "✅", "❓"] as const;
export const importanceSchema = z.enum(IMPORTANCE);
export const settingsSchema = z
  .object({
    theme: z.enum(["light", "dark"]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    font: z.enum(["Arial", "Georgia", "monospace"]),
    font_size: z.number().int().min(12).max(20),
    compact: z.boolean(),
    enter_to_send: z.boolean(),
    show_ai_tags: z.boolean(),
    sounds: z.boolean(),
  })
  .partial()
  .strict();

export function priorityFor(role: string, importance: string) {
  return (
    (role === "teacher" ? 100 : 0) +
    (importance === "important"
      ? 40
      : importance === "slightly_important"
        ? 20
        : 0)
  );
}

export function spamKey(body: string) {
  return body.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
