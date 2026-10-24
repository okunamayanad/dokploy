import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { deployPreviewCompose } from "@dokploy/server/services/compose-preview";
import { findPreviewDeploymentById } from "@dokploy/server/services/preview-deployment";

const result = JSON.parse(readFileSync(".docker/fixture/result.json", "utf8"));
await deployPreviewCompose({
	composeId: "integration-compose",
	previewDeploymentId: result.previewDeploymentId,
	rebuild: true,
});
const preview = await findPreviewDeploymentById(result.previewDeploymentId);
assert.equal(preview.previewStatus, "done");
assert.ok(preview.domain);
for (let attempt = 0; attempt < 30; attempt++) {
	try {
		const response = execFileSync(
			"curl",
			[
				"--max-time",
				"5",
				"-fsS",
				"-H",
				`Host: ${preview.domain.host}`,
				"http://engine/",
			],
			{ encoding: "utf8", stdio: "pipe" },
		);
		assert.match(response, /preview-101-version-2/);
		console.log(
			"PASS Existing preview rebuild and HTTP routing after deployment-host symlink validation",
		);
		process.exit(0);
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}
throw new Error("Preview HTTP unavailable after rebuild");
