import { dbUrl } from "@dokploy/server/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { migratePersonal } from "./personal-migration";

const sql = postgres(dbUrl, { max: 1 });
const db = drizzle(sql);

export const migration = async () =>
	await migratePersonal(db)
		.then(() => {
			console.log("Migration complete");
			sql.end();
		})
		.catch((error) => {
			console.error("Migration failed", error);
			process.exitCode = 1;
			throw error;
		})
		.finally(() => {
			sql.end();
		});
