import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { migratePersonal } from "../../server/db/personal-migration";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);
const root = mkdtempSync(join(tmpdir(), "dokploy-upstream-"));
const upstream = JSON.parse(
	readFileSync("packages/server/src/personal-release.json", "utf8"),
).upstreamCommit;
const journalPath = "apps/dokploy/drizzle/meta/_journal.json";
const journal = execFileSync("git", ["show", `${upstream}:${journalPath}`]);
mkdirSync(join(root, "meta"));
writeFileSync(join(root, "meta/_journal.json"), journal);
for (const entry of JSON.parse(journal.toString()).entries) {
	writeFileSync(
		join(root, `${entry.tag}.sql`),
		execFileSync("git", [
			"show",
			`${upstream}:apps/dokploy/drizzle/${entry.tag}.sql`,
		]),
	);
}
try {
	await migrate(db, { migrationsFolder: root });
	const before =
		await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
	// An existing upstream record must survive both the upgrade and a repeated startup.
	await sql`create table personal_upgrade_sentinel (value text not null)`;
	await sql`insert into personal_upgrade_sentinel values ('preserved')`;
	process.chdir("apps/dokploy");
	await migratePersonal(db);
	await migratePersonal(db);
	const [sentinel] = await sql`select value from personal_upgrade_sentinel`;
	const [personal] =
		await sql`select count(*)::int as count from drizzle.__personal_migrations`;
	const [after] =
		await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
	const columns =
		await sql`select column_name from information_schema.columns where table_name = 'compose' and column_name = 'previewEnv'`;
	if (
		sentinel?.value !== "preserved" ||
		personal?.count !== 1 ||
		after!.count < before[0]!.count ||
		columns.length !== 1
	)
		throw new Error("Upgrade verification failed");
	console.log(
		"Upstream → personal migration and repeated startup passed; data preserved.",
	);
} finally {
	await sql.end();
}
