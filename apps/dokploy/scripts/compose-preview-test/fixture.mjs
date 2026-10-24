// Local GitHub API fixture. Git, TLS, PostgreSQL and Docker are real; no requests
// or comments are sent to GitHub. Run only inside the disposable test install.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:https";
import { join } from "node:path";

const root = join(process.cwd(), ".docker", "fixture");
mkdirSync(root, { recursive: true });
const certificate = join(root, "cert.pem");
const privateKey = join(root, "tls-key.pem");
if (!existsSync(certificate)) {
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			privateKey,
			"-out",
			certificate,
			"-days",
			"2",
			"-subj",
			"/CN=github.fixture.test",
			"-addext",
			"subjectAltName=DNS:github.fixture.test",
		],
		{ stdio: "ignore" },
	);
}
const stateFile = join(root, "state.json");
if (!existsSync(stateFile)) {
	const { privateKey: appKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs1", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	writeFileSync(
		stateFile,
		JSON.stringify({
			webhookSecret: randomBytes(32).toString("hex"),
			appKey,
			token: randomBytes(32).toString("hex"),
		}),
		{ mode: 0o600 },
	);
}
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const work = join(root, "work");
const repos = join(root, "repos");
const bare = join(repos, "acme", "preview.git");
const git = (args, cwd = work) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();

if (!existsSync(bare)) {
	mkdirSync(work, { recursive: true });
	mkdirSync(join(repos, "acme"), { recursive: true });
	git(["init", "-b", "main"]);
	git(["config", "user.name", "Preview Integration Test"]);
	git(["config", "user.email", "preview@example.test"]);
	writeFileSync(
		join(work, "Dockerfile"),
		'FROM busybox:1.37.0\nCOPY index.html /www/index.html\nCMD ["sh", "-c", "echo $DEPLOYMENT > /data/mode; exec httpd -f -p 8080 -h /www"]\n',
	);
	writeFileSync(
		join(work, "compose.yml"),
		`services:
  web:
    build: .
    image: preview-test-production
    container_name: preview-test-production
    ports: ["18081:8080"]
    environment:
      DEPLOYMENT: \${DEPLOYMENT:-production}
    volumes: ["data:/data"]
    labels:
      traefik.enable: "true"
      traefik.http.routers.fixture-production.rule: Host(\`production.example.test\`)
      traefik.http.services.fixture-production.loadbalancer.server.port: "8080"
volumes:
  data:
    name: preview-test-production-data
networks:
  default:
    name: preview-test-production-network
`,
	);
	writeFileSync(join(work, "index.html"), "production-version\n");
	git(["add", "."]);
	git(["commit", "-m", "Production"]);
	git(["checkout", "-b", "pr-101"]);
	writeFileSync(join(work, "index.html"), "preview-101-version-1\n");
	git(["commit", "-am", "First PR"]);
	git(["checkout", "-b", "pr-102", "main"]);
	writeFileSync(join(work, "index.html"), "preview-102-version-1\n");
	git(["commit", "-am", "Second PR"]);
	git(["clone", "--bare", work, bare]);
	git(["--git-dir", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);
	for (const number of [101, 102])
		git([
			"--git-dir",
			bare,
			"update-ref",
			`refs/pull/${number}/head`,
			`refs/heads/pr-${number}`,
		]);
	git(["checkout", "main"]);
}

const comments = new Map();
let nextComment = 1;
const server = createServer(
	{ key: readFileSync(privateKey), cert: readFileSync(certificate) },
	async (req, res) => {
		const url = new URL(req.url, "https://github.fixture.test:14443");
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const input = Buffer.concat(chunks);
		const json = (value, status = 200) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(value));
		};
		if (url.pathname === "/health")
			return json({ ready: true, comments: comments.size });
		if (url.pathname === "/fixture/comments")
			return json([...comments.values()]);
		if (url.pathname === "/fixture/pr" && req.method === "POST") {
			const scenario = JSON.parse(input.toString());
			if (!Number.isSafeInteger(scenario.number) || scenario.number < 1)
				return json({ error: "Invalid PR number" }, 400);
			git(["checkout", "-B", `scenario-${scenario.number}`, "main"]);
			writeFileSync(join(work, "compose.yml"), scenario.compose);
			if (scenario.symlink)
				symlinkSync("/etc/os-release", join(work, "linked.env"));
			if (scenario.dockerfile)
				writeFileSync(join(work, "Dockerfile"), scenario.dockerfile);
			git(["add", "."]);
			git([
				"commit",
				"--allow-empty",
				"-m",
				`Regression PR ${scenario.number}`,
			]);
			git([
				"--git-dir",
				bare,
				"fetch",
				work,
				`+refs/heads/scenario-${scenario.number}:refs/pull/${scenario.number}/head`,
			]);
			git(["checkout", "main"]);
			return json({ created: true });
		}
		if (url.pathname === "/fixture/advance" && req.method === "POST") {
			git(["checkout", "pr-101"]);
			writeFileSync(join(work, "index.html"), "preview-101-version-2\n");
			git(["commit", "-am", "Update first PR"]);
			git([
				"--git-dir",
				bare,
				"fetch",
				work,
				"+refs/heads/pr-101:refs/pull/101/head",
			]);
			git(["checkout", "main"]);
			return json({ updated: true });
		}
		if (url.pathname.endsWith("/access_tokens"))
			return json(
				{
					token: state.token,
					expires_at: new Date(Date.now() + 3600_000).toISOString(),
					permissions: { contents: "read", issues: "write" },
				},
				201,
			);
		if (/\/collaborators\/[^/]+\/permission$/.test(url.pathname))
			return json({
				permission: url.pathname.includes("/outsider/") ? "read" : "write",
				user: { login: "collaborator" },
			});
		if (/\/issues\/\d+\/comments$/.test(url.pathname)) {
			if (req.method === "GET") return json([...comments.values()]);
			const comment = {
				id: nextComment++,
				...JSON.parse(input.toString() || "{}"),
			};
			comments.set(comment.id, comment);
			return json(comment, 201);
		}
		const commentId = url.pathname.match(/\/issues\/comments\/(\d+)$/)?.[1];
		if (commentId) {
			const comment = comments.get(Number(commentId));
			if (!comment) return json({ message: "Not Found" }, 404);
			if (req.method === "PATCH")
				Object.assign(comment, JSON.parse(input.toString()));
			return json(comment);
		}
		if (url.pathname.startsWith("/acme/preview.git/")) {
			try {
				const output = execFileSync("git", ["http-backend"], {
					input,
					maxBuffer: 16 * 1024 * 1024,
					env: {
						...process.env,
						GIT_PROJECT_ROOT: repos,
						GIT_HTTP_EXPORT_ALL: "1",
						PATH_INFO: url.pathname,
						QUERY_STRING: url.search.slice(1),
						REQUEST_METHOD: req.method,
						CONTENT_TYPE: req.headers["content-type"] || "",
						CONTENT_LENGTH: String(input.length),
						REMOTE_USER: "fixture",
						SERVER_PROTOCOL: "HTTP/1.1",
					},
				});
				const separator = output.indexOf("\r\n\r\n");
				for (const header of output
					.subarray(0, separator)
					.toString()
					.split("\r\n")) {
					const index = header.indexOf(":");
					if (index < 0) continue;
					const name = header.slice(0, index);
					const value = header.slice(index + 1).trim();
					if (name.toLowerCase() === "status")
						res.statusCode = Number(value.split(" ")[0]);
					else res.setHeader(name, value);
				}
				return res.end(output.subarray(separator + 4));
			} catch (error) {
				return json({ error: error.message }, 500);
			}
		}
		json(
			{ message: `Unhandled fixture endpoint: ${req.method} ${url.pathname}` },
			404,
		);
	},
);
server.listen(14443, "0.0.0.0", () =>
	console.log("Local GitHub fixture listening on :14443"),
);
