import { parse } from "shell-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Test generated clone commands without requesting real GitHub App tokens.
const mockFindGithubById = vi.hoisted(() => vi.fn());

vi.mock("@dokploy/server/services/github", () => ({
	findGithubById: mockFindGithubById,
}));

vi.mock("@octokit/auth-app", () => ({
	createAppAuth: vi.fn(),
}));

vi.mock("octokit", () => ({
	Octokit: class {
		auth = async () => ({ token: "gh-token" });
	},
}));

const { cloneGithubRepository } = await import(
	"@dokploy/server/utils/providers/github"
);

const provider = (githubUrl: string) => ({
	githubId: "gh-1",
	githubUrl,
	githubAppId: 1,
	githubPrivateKey: "key",
	githubInstallationId: "42",
});

const clone = async () => {
	const command = await cloneGithubRepository({
		appName: "my-app",
		owner: "acme",
		repository: "web",
		branch: "main",
		githubId: "gh-1",
		enableSubmodules: false,
		serverId: null,
	});
	return command.replace(/\\/g, "");
};

describe("cloneGithubRepository host", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("clones from github.com for a default provider", async () => {
		mockFindGithubById.mockResolvedValue(provider("https://github.com"));

		const command = await clone();

		expect(command).toContain("https://github.com/acme/web.git");
		expect(command).not.toContain("ghe.com");
	});

	it("clones from the Enterprise host, not github.com", async () => {
		mockFindGithubById.mockResolvedValue(provider("https://acme.ghe.com"));

		const command = await clone();

		expect(command).toContain("https://acme.ghe.com/acme/web.git");
		expect(command).not.toContain("github.com");
	});

	it("clones from a self-hosted Enterprise Server host", async () => {
		mockFindGithubById.mockResolvedValue(
			provider("https://github.corp.acme.com"),
		);

		const command = await clone();

		expect(command).toContain("https://github.corp.acme.com/acme/web.git");
	});

	it("keeps an explicit port in the clone host", async () => {
		mockFindGithubById.mockResolvedValue(
			provider("https://github.acme.com:8443"),
		);

		const command = await clone();

		expect(command).toContain("https://github.acme.com:8443/acme/web.git");
	});

	it("falls back to github.com for a provider stored before this feature", async () => {
		mockFindGithubById.mockResolvedValue(provider(""));

		const command = await clone();

		expect(command).toContain("https://github.com/acme/web.git");
	});
	it("fetches the PR head ref for forks instead of a same-named base branch", async () => {
		mockFindGithubById.mockResolvedValue(provider("https://github.com"));
		const command = await cloneGithubRepository({
			appName: "preview-web",
			owner: "acme",
			repository: "web",
			branch: "feature",
			githubId: "gh-1",
			enableSubmodules: true,
			serverId: null,
			type: "compose",
			pullRequestNumber: "42",
		});
		expect(command).toContain("refs/pull/42/head");
		expect(command).toContain("checkout --detach FETCH_HEAD");
		expect(command).toContain("submodule update --init --recursive");
		expect(command).not.toContain("--branch feature");
	});

	it.each(["https://github.com", "https://github.acme.com:8443"])(
		"authenticates PR checkout for LFS using transient config on %s",
		async (githubUrl) => {
			mockFindGithubById.mockResolvedValue(provider(githubUrl));
			const command = await cloneGithubRepository({
				appName: "preview-web",
				owner: "acme",
				repository: "web",
				branch: "feature",
				githubId: "gh-1",
				enableSubmodules: true,
				serverId: null,
				type: "compose",
				outputPathOverride: "/tmp/compose preview/code",
				pullRequestNumber: "42",
			});
			const commands = command
				.split(";")
				.filter(Boolean)
				.map((part) => parse(part));
			const gitCommands = commands.filter((args) => args[0] === "git");
			const credentials = Buffer.from("oauth2:gh-token").toString("base64");
			const header = `http.${githubUrl}/.extraHeader=Authorization: Basic ${credentials}`;

			// Checkout runs LFS smudge as a child process; auth must be on this
			// invocation too, not just on the preceding clone and fetch.
			expect(gitCommands.map((args) => args.includes(header))).toEqual([
				true,
				true,
				true,
				true,
			]);
			expect(gitCommands[2]).toEqual([
				"git",
				"-C",
				"/tmp/compose preview/code",
				"-c",
				header,
				"checkout",
				"--detach",
				"FETCH_HEAD",
			]);
			expect(gitCommands.some((args) => args.includes("config"))).toBe(false);
			expect(command).not.toContain("gh-token");
			for (const args of commands.filter((args) => args[0] !== "git")) {
				expect(JSON.stringify(args)).not.toContain(credentials);
			}
		},
	);
});
