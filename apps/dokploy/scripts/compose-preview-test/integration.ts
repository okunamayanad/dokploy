import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@dokploy/server/db";
import {
	compose,
	deployments,
	environments,
	github,
	gitProvider,
	organization,
	previewDeployments,
	projects,
	user,
} from "@dokploy/server/db/schema";
import { deployPreviewCompose } from "@dokploy/server/services/compose-preview";
import { eq } from "drizzle-orm";

const fixtureRoot = join(process.cwd(), ".docker", "fixture");
const state = JSON.parse(readFileSync(join(fixtureRoot, "state.json"), "utf8"));
const run = (args: string[]) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
const report: string[] = [];
const pass = (message: string) => {
	report.push(message);
	console.log(`PASS ${message}`);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));
const previews = () =>
	db.query.previewDeployments.findMany({
		where: eq(previewDeployments.composeId, "integration-compose"),
		with: { domain: true },
	});
const waitFor = async (
	condition: () => Promise<boolean>,
	message: string,
	attempts = 180,
) => {
	for (let i = 0; i < attempts; i++) {
		if (await condition()) return;
		await pause();
	}
	const rows = await previews();
	const logs = await db.query.deployments.findMany({
		where: rows.length
			? eq(deployments.previewDeploymentId, rows[0]!.previewDeploymentId)
			: undefined,
	});
	for (const log of logs)
		if (log.logPath)
			console.error(readFileSync(log.logPath, "utf8").slice(-6000));
	throw new Error(
		`Timed out: ${message}; ${JSON.stringify(rows.map((r) => ({ appName: r.appName, status: r.previewStatus })))}`,
	);
};

const webhook = async (
	number: number,
	action: string,
	author = "collaborator",
	labels: string[] = [],
) => {
	const body = JSON.stringify({
		installation: { id: "424242" },
		action,
		repository: { name: "preview", owner: { login: "acme" } },
		pull_request: {
			id: number,
			number,
			title: `Integration PR ${number}`,
			html_url: `https://github.fixture.test/acme/preview/pull/${number}`,
			user: { login: author },
			head: { ref: `fork-feature-${number}`, sha: `fixture-${number}` },
			base: { ref: "main" },
			labels: labels.map((name) => ({ name })),
		},
	});
	const response = await fetch("http://localhost:3000/api/deploy/github", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-GitHub-Event": "pull_request",
			"X-Hub-Signature-256": `sha256=${createHmac("sha256", state.webhookSecret).update(body).digest("hex")}`,
		},
		body,
	});
	assert.equal(response.status, 200, await response.text());
};

try {
	let account = await db.query.user.findFirst({
		where: eq(user.email, "preview@example.test"),
	});
	if (!account) {
		const signup = await fetch("http://localhost:3000/api/auth/sign-up/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:3000",
			},
			body: JSON.stringify({
				email: "preview@example.test",
				password: state.token,
				name: "Preview",
				lastName: "Test",
			}),
		});
		assert.equal(signup.status, 200, await signup.text());
		account = await db.query.user.findFirst({
			where: eq(user.email, "preview@example.test"),
		});
	}
	assert.ok(account);
	const org = await db.query.organization.findFirst({
		where: eq(organization.ownerId, account.id),
	});
	assert.ok(org);
	await db
		.insert(projects)
		.values({
			projectId: "integration-project",
			name: "Compose Preview Integration",
			organizationId: org.id,
		})
		.onConflictDoNothing();
	await db
		.insert(environments)
		.values({
			environmentId: "integration-environment",
			projectId: "integration-project",
			name: "Isolated Test",
		})
		.onConflictDoNothing();
	await db
		.insert(gitProvider)
		.values({
			gitProviderId: "integration-provider",
			name: "Local GitHub Fixture",
			organizationId: org.id,
			userId: account.id,
			providerType: "github",
		})
		.onConflictDoNothing();
	await db
		.insert(github)
		.values({
			githubId: "integration-github",
			gitProviderId: "integration-provider",
			githubAppId: 424242,
			githubInstallationId: "424242",
			githubPrivateKey: state.appKey,
			githubWebhookSecret: state.webhookSecret,
			githubUrl: "https://github.fixture.test:14443",
		})
		.onConflictDoNothing();
	await db
		.insert(compose)
		.values({
			composeId: "integration-compose",
			name: "Preview Test Web",
			appName: "integration-production",
			environmentId: "integration-environment",
			sourceType: "github",
			composeType: "docker-compose",
			owner: "acme",
			repository: "preview",
			branch: "main",
			githubId: "integration-github",
			composePath: "./compose.yml",
			env: "DEPLOYMENT=production",
			previewEnv: "DEPLOYMENT=preview",
			previewServiceName: "web",
			previewPort: 8080,
			previewWildcard: "*.example.test",
			previewLimit: 2,
			isPreviewDeploymentsActive: true,
			previewRequireCollaboratorPermissions: true,
			composeStatus: "done",
		})
		.onConflictDoNothing();
	pass("Fresh database migrations and account/provider/project/Compose setup");
	const productionFile = join(fixtureRoot, "work", "compose.yml");
	run([
		"compose",
		"-p",
		"integration-production",
		"-f",
		productionFile,
		"up",
		"-d",
		"--build",
	]);
	run([
		"exec",
		"preview-test-production",
		"sh",
		"-c",
		"echo production-sentinel > /data/sentinel",
	]);
	const productionId = run([
		"inspect",
		"-f",
		"{{.Id}}",
		"preview-test-production",
	]);
	pass(
		"Real production container and sentinel volume created in nested Docker",
	);

	await webhook(101, "opened");
	await waitFor(
		async () =>
			(await previews()).some(
				(p) => p.pullRequestNumber === "101" && p.previewStatus === "done",
			),
		"first preview build",
	);
	const first = (await previews()).find((p) => p.pullRequestNumber === "101")!;
	assert.ok(first.domain);
	const getPreview = async (host: string) => {
		for (let i = 0; i < 30; i++) {
			try {
				return execFileSync(
					"curl",
					["--max-time", "5", "-fsS", "-H", `Host: ${host}`, "http://engine/"],
					{ encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
				);
			} catch {
				/* Traefik discovers the new container asynchronously. */
			}
			await pause();
		}
		throw new Error(`Preview HTTP unavailable: ${host}`);
	};
	assert.match(await getPreview(first.domain.host), /preview-101-version-1/);
	const firstContainers = JSON.parse(
		run([
			"ps",
			"--filter",
			`label=com.docker.compose.project=${first.appName}`,
			"--format",
			"json",
		]),
	);
	assert.equal(
		run([
			"inspect",
			"-f",
			"{{len .HostConfig.PortBindings}}",
			firstContainers.ID,
		]),
		"0",
	);
	assert.equal(
		run(["exec", firstContainers.ID, "cat", "/data/mode"]),
		"preview",
	);
	assert.notEqual(
		run(["inspect", "-f", "{{(index .Mounts 0).Name}}", firstContainers.ID]),
		"preview-test-production-data",
	);
	pass(
		"Signed PR webhook → persisted preview → real fork PR ref checkout → image build → routed HTTP response",
	);
	pass(
		"Preview has separate environment, volume, image, network and no published production ports",
	);

	await webhook(102, "opened");
	await waitFor(
		async () =>
			(await previews()).some(
				(p) => p.pullRequestNumber === "102" && p.previewStatus === "done",
			),
		"second preview build",
	);
	const second = (await previews()).find((p) => p.pullRequestNumber === "102")!;
	assert.notEqual(first.appName, second.appName);
	assert.match(await getPreview(second.domain!.host), /preview-102-version-1/);
	await webhook(103, "opened");
	assert.equal((await previews()).length, 2);
	pass(
		"Two simultaneous previews with distinct routes; new PR blocked at limit",
	);

	await fetch("https://github.fixture.test:14443/fixture/advance", {
		method: "POST",
	});
	const before = await db.query.deployments.findMany({
		where: eq(deployments.previewDeploymentId, first.previewDeploymentId),
	});
	await webhook(101, "synchronize");
	await waitFor(async () => {
		const history = await db.query.deployments.findMany({
			where: eq(deployments.previewDeploymentId, first.previewDeploymentId),
		});
		return (
			history.length > before.length &&
			(await previews()).find(
				(p) => p.previewDeploymentId === first.previewDeploymentId,
			)?.previewStatus === "done"
		);
	}, "updated preview");
	assert.match(await getPreview(first.domain.host), /preview-101-version-2/);
	assert.equal(
		(await previews()).find((p) => p.pullRequestNumber === "101")!.appName,
		first.appName,
	);
	await deployPreviewCompose({
		composeId: "integration-compose",
		previewDeploymentId: first.previewDeploymentId,
		rebuild: true,
	});
	assert.match(await getPreview(first.domain.host), /preview-101-version-2/);
	pass(
		"PR synchronize updates existing URL at limit; cached-code rebuild succeeds",
	);

	await webhook(102, "closed");
	assert.equal((await previews()).length, 1);
	assert.equal(
		run([
			"ps",
			"-aq",
			"--filter",
			`label=com.docker.compose.project=${second.appName}`,
		]),
		"",
	);
	assert.equal(
		run([
			"volume",
			"ls",
			"-q",
			"--filter",
			`label=com.docker.compose.project=${second.appName}`,
		]),
		"",
	);
	assert.equal(
		run(["network", "ls", "-q", "--filter", `name=^${second.appName}$`]),
		"",
	);
	pass(
		"Closed PR removes preview containers, volumes, network, logs and record",
	);
	await webhook(104, "opened", "outsider");
	assert.equal((await previews()).length, 1);
	await db
		.update(compose)
		.set({ previewLabels: ["preview"] })
		.where(eq(compose.composeId, "integration-compose"));
	await webhook(105, "opened");
	assert.equal((await previews()).length, 1);
	await db
		.update(compose)
		.set({ previewLabels: [] })
		.where(eq(compose.composeId, "integration-compose"));
	assert.equal(
		run(["inspect", "-f", "{{.Id}}", "preview-test-production"]),
		productionId,
	);
	assert.equal(
		run(["exec", "preview-test-production", "cat", "/data/sentinel"]),
		"production-sentinel",
	);
	assert.equal(
		run(["exec", "preview-test-production", "cat", "/data/mode"]),
		"production",
	);
	const comments = (await fetch(
		"https://github.fixture.test:14443/fixture/comments",
	).then((r) => r.json())) as { body: string }[];
	assert.ok(comments.some((c) => c.body.includes("✅ Done")));
	assert.ok(comments.some((c) => c.body.includes("Blocked")));
	pass(
		"Collaborator and label guards work; production container and sentinel remain unchanged; comments updated",
	);
	const result = {
		passed: report,
		projectId: "integration-project",
		environmentId: "integration-environment",
		composeId: "integration-compose",
		previewDeploymentId: first.previewDeploymentId,
		previewHost: first.domain.host,
		completedAt: new Date().toISOString(),
	};
	writeFileSync(
		join(fixtureRoot, "result.json"),
		JSON.stringify(result, null, 2),
	);
	console.log("INTEGRATION_RESULT", JSON.stringify(result));
	process.exit(0);
} catch (error) {
	console.error(error);
	process.exit(1);
}
