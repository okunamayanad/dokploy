import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL(
	"../../packages/server/src/personal-release.json",
	import.meta.url,
);
const release = JSON.parse(readFileSync(path, "utf8"));
const [command, upstream] = process.argv.slice(2);
if (command === "bump") {
	const parts = release.version.slice(1).split(".").map(Number);
	parts[3]++;
	release.version = `v${parts.join(".")}`;
} else if (command === "upstream" && /^v\d+\.\d+\.\d+$/.test(upstream ?? "")) {
	release.version = `${upstream}.0`;
	release.upstreamVersion = upstream;
	release.upstreamCommit = execFileSync(
		"git",
		["rev-parse", `${upstream}^{commit}`],
		{ encoding: "utf8" },
	).trim();
} else if (command !== "show") {
	throw new Error(
		"Usage: node scripts/personal/version.mjs show|bump|upstream vX.Y.Z",
	);
}
if (command !== "show")
	writeFileSync(path, `${JSON.stringify(release, null, 2)}\n`);
console.log(release.version);
