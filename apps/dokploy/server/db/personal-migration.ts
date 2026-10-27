import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export const migratePersonal = async (db: PostgresJsDatabase) => {
	await migrate(db, { migrationsFolder: "drizzle" });
	await migrate(db, {
		migrationsFolder: "personal-migrations",
		migrationsTable: "__personal_migrations",
	});
};
