import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const workspaceState = sqliteTable("wicky_workspace", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  payload: text("payload").notNull(),
});
