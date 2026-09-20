/** One private workspace uses a versioned aggregate to retain atomic domain invariants. */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceState = sqliteTable("mx_state", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  payload: text("payload").notNull(),
});
