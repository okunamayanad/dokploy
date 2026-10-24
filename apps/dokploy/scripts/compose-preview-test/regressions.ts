import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { db } from "@dokploy/server/db";
import { deployments, previewDeployments } from "@dokploy/server/db/schema";
import { and, eq } from "drizzle-orm";

const state = JSON.parse(readFileSync(".docker/fixture/state.json", "utf8"));
const run = (args: string[]) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const get = (number: number) =>
	db.query.previewDeployments.findFirst({
		where: and(
			eq(previewDeployments.composeId, "integration-compose"),
			eq(previewDeployments.pullRequestNumber, String(number)),
		),
	});
const until = async (condition: () => Promise<boolean>, label: string) => {
	for (let i = 0; i < 120; i++) {
		if (await condition()) return;
		await wait();
	}
	throw new Error(`Timed out: ${label}`);
};
const webhook = async (number: number, action: string) => {
	const body = JSON.stringify({
		installation: { id: "424242" },
		action,
		repository: { name: "preview", owner: { login: "acme" } },
		pull_request: {
			id: number,
			number,
			title: `Regression ${number}`,
			html_url: `https://github.fixture.test/pull/${number}`,
			user: { login: "collaborator" },
			head: { ref: `scenario-${number}`, sha: "regression" },
			base: { ref: "main" },
			labels: [],
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
const scenario = async (
	number: number,
	compose: string,
	dockerfile?: string,
	symlink = false,
) => {
	const response = await fetch("https://github.fixture.test:14443/fixture/pr", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ number, compose, dockerfile, symlink }),
	});
	assert.equal(response.status, 200, await response.text());
};

run(["volume", "create", "preview-protected-unused"]);
run([
	"run",
	"--rm",
	"-v",
	"preview-protected-unused:/data",
	"busybox:1.37.0",
	"sh",
	"-c",
	"echo keep-me > /data/sentinel",
]);
const cases = [
	"services:\n  web:\n    image: busybox:1.37.0\n    network_mode: host\n    volumes: [data:/data]\nvolumes:\n  data:\n    name: preview-protected-unused\n",
	"services: [ invalid: [ YAML",
	"include: [production.yml]\nservices:\n  web:\n    image: busybox:1.37.0\n",
	"services:\n  web:\n    extends:\n      file: production.yml\n      service: web\n",
	"services:\n  web:\n    image: busybox:1.37.0\n    volumes: [data:/data]\nvolumes:\n  data:\n    driver: local\n    driver_opts:\n      type: none\n      o: bind\n      device: /production-data\n",
	"services:\n  web:\n    image: busybox:1.37.0\nconfigs:\n  key:\n    file: /production/key\n",
	"services:\n  web:\n    image: busybox:1.37.0\n    volumes_from: [container:preview-test-production:rw]\n",
	"services:\n  web:\n    image: busybox:1.37.0\n    label_file: ./routes.labels\n",
	"services:\n  web:\n    image: busybox:1.37.0\n    env_file: /etc/os-release\n",
	"services:\n  web:\n    image: busybox:1.37.0\n    env_file: ./linked.env\n",
	"services:\n  web:\n    image: busybox:1.37.0\nconfigs:\n  key:\n    file: ./linked.env\n",
	"services:\n  web:\n    image: busybox:1.37.0\nsecrets:\n  key:\n    file: ./linked.env\n",
	"services:\n  web:\n    image: busybox:1.37.0\n    volumes: [./linked.env:/data/production.env]\n",
	'services:\n  web:\n    image: busybox:1.37.0\n    labels: ["${ROUTING_PREFIX:-traefik}.http.routers.production.rule=Host(`production.example.test`)"]\n',
];
for (const [index, yaml] of cases.entries()) {
	const number = 106 + index;
	await scenario(number, yaml, undefined, yaml.includes("linked.env"));
	await webhook(number, "opened");
	await until(
		async () => (await get(number))?.previewStatus === "error",
		`rejected PR ${number}`,
	);
	const preview = (await get(number))!;
	await webhook(number, "closed");
	assert.equal(await get(number), undefined);
	assert.equal(
		run([
			"ps",
			"-aq",
			"--filter",
			`label=com.docker.compose.project=${preview.appName}`,
		]),
		"",
	);
	assert.equal(
		run([
			"run",
			"--rm",
			"-v",
			"preview-protected-unused:/data",
			"busybox:1.37.0",
			"cat",
			"/data/sentinel",
		]),
		"keep-me",
	);
	console.log(
		`PASS Rejected PR ${number} cleans up without interpreting original YAML or deleting protected volume`,
	);
}

const slow = `FROM busybox:1.37.0\nRUN sleep 12 && echo ${Date.now()}\nCOPY index.html /www/index.html\nCMD ["httpd", "-f", "-p", "8080", "-h", "/www"]\n`;
await scenario(
	122,
	"services:\n  web:\n    build: .\n    volumes: [data:/data]\nvolumes:\n  data: {}\n",
	slow,
);
await webhook(122, "opened");
const racing = (await get(122))!;
await until(async () => {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.previewDeploymentId, racing.previewDeploymentId),
	});
	return !!(
		deployment?.logPath &&
		existsSync(deployment.logPath) &&
		readFileSync(deployment.logPath, "utf8").includes("RUN sleep 12")
	);
}, "Docker build is active");
await webhook(122, "closed");
await wait(16000);
assert.equal(await get(122), undefined);
assert.equal(
	run([
		"ps",
		"-aq",
		"--filter",
		`label=com.docker.compose.project=${racing.appName}`,
	]),
	"",
);
assert.equal(
	run([
		"volume",
		"ls",
		"-q",
		"--filter",
		`label=com.docker.compose.project=${racing.appName}`,
	]),
	"",
);
assert.equal(
	run(["network", "ls", "-q", "--filter", `name=^${racing.appName}$`]),
	"",
);
assert.equal(
	run(["exec", "preview-test-production", "cat", "/data/sentinel"]),
	"production-sentinel",
);
console.log(
	"PASS Closing a PR during a real Docker build leaves no orphan containers, volume or network; production survives",
);
process.exit(0);
