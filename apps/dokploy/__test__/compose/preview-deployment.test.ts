import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findCompose: vi.fn(),
	findPreview: vi.fn(),
	updatePreview: vi.fn(),
	createDeployment: vi.fn(),
	updateDeploymentStatus: vi.fn(),
	run: vi.fn(),
	runRemote: vi.fn(),
	clone: vi.fn(),
	build: vi.fn(),
	patch: vi.fn(),
	commentExists: vi.fn(),
	createComment: vi.fn(),
	updateComment: vi.fn(),
}));

vi.mock("@dokploy/server/services/compose", () => ({
	findComposeById: mocks.findCompose,
}));
vi.mock("@dokploy/server/services/preview-deployment", () => ({
	findPreviewDeploymentById: mocks.findPreview,
	updatePreviewDeployment: mocks.updatePreview,
}));
vi.mock("@dokploy/server/services/deployment", () => ({
	createDeploymentPreview: mocks.createDeployment,
	updateDeploymentStatus: mocks.updateDeploymentStatus,
}));
vi.mock("@dokploy/server/services/github", () => ({
	issueCommentExists: mocks.commentExists,
	createPreviewDeploymentComment: mocks.createComment,
	updateIssueComment: mocks.updateComment,
	getIssueComment: (_name: string, state: string) => state,
}));
vi.mock("@dokploy/server/services/patch", () => ({
	generateApplyPatchesCommand: mocks.patch,
}));
vi.mock("@dokploy/server/utils/providers/github", () => ({
	cloneGithubRepository: mocks.clone,
}));
vi.mock("@dokploy/server/utils/builders/compose", () => ({
	getBuildComposeCommand: mocks.build,
}));
vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mocks.run,
	execAsyncRemote: mocks.runRemote,
}));

import {
	deployPreviewCompose,
	getPreviewCompose,
	removePreviewCompose,
} from "@dokploy/server/services/compose-preview";

describe("Compose preview lifecycle", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.findCompose.mockResolvedValue({
			composeId: "compose",
			sourceType: "github",
			composeType: "docker-compose",
			appName: "production",
			name: "web",
			serverId: null,
			previewEnv: "PREVIEW=true",
			env: "PRODUCTION_SECRET=keep-out",
			command: "production-command",
			suffix: "production",
			mounts: [{ path: "/production" }],
			serviceNetworks: [{ networkIds: ["production-network"] }],
			domains: [{ host: "production.example.com" }],
			composePath: "./compose.yml",
		});
		mocks.findPreview.mockResolvedValue({
			composeId: "compose",
			previewDeploymentId: "preview",
			appName: "preview-web",
			branch: "feature",
			pullRequestNumber: "42",
			pullRequestCommentId: "123",
			isDeleting: false,
			domain: { host: "preview.example.com", https: true },
		});
		mocks.createDeployment.mockResolvedValue({
			deploymentId: "deployment",
			logPath: "/logs/preview.log",
		});
		mocks.clone.mockResolvedValue("clone;");
		mocks.patch.mockResolvedValue("patch;");
		mocks.build.mockResolvedValue("build;");
		mocks.run.mockResolvedValue({ stdout: "" });
		mocks.runRemote.mockResolvedValue({ stdout: "" });
		mocks.commentExists.mockResolvedValue(true);
	});

	it("deploys the PR using only preview settings and leaves production untouched", async () => {
		const preview = await getPreviewCompose("compose", "preview");
		expect(preview).toMatchObject({
			appName: "preview-web",
			branch: "feature",
			isolatedDeployment: true,
			command: "",
			mounts: [],
			serviceNetworks: [],
			domains: [{ host: "preview.example.com" }],
		});
		expect(preview.env).toContain("PREVIEW=true");
		expect(preview.env).not.toContain("PRODUCTION_SECRET");
		await deployPreviewCompose({
			composeId: "compose",
			previewDeploymentId: "preview",
		});
		expect(mocks.clone).toHaveBeenCalledWith(
			expect.objectContaining({
				appName: "preview-web",
				type: "compose",
				pullRequestNumber: "42",
			}),
		);
		expect(mocks.patch).toHaveBeenCalledWith(
			expect.objectContaining({ appName: "preview-web" }),
		);
		expect(mocks.updatePreview).toHaveBeenLastCalledWith("preview", {
			previewStatus: "done",
		});
	});

	it("rebuilds cached code without fetching the repository", async () => {
		await deployPreviewCompose({
			composeId: "compose",
			previewDeploymentId: "preview",
			rebuild: true,
		});
		expect(mocks.clone).not.toHaveBeenCalled();
		expect(mocks.build).toHaveBeenCalled();
	});

	it("runs remote preview builds on the parent's server", async () => {
		mocks.findCompose.mockResolvedValue({
			...(await mocks.findCompose()),
			serverId: "remote",
		});
		await deployPreviewCompose({
			composeId: "compose",
			previewDeploymentId: "preview",
		});
		expect(mocks.run).not.toHaveBeenCalled();
		expect(mocks.runRemote).toHaveBeenCalledWith(
			"remote",
			expect.stringContaining("build;"),
		);
	});

	it("marks deployment and preview failed when Docker fails", async () => {
		mocks.run.mockRejectedValueOnce(new Error("Docker failed"));
		await expect(
			deployPreviewCompose({
				composeId: "compose",
				previewDeploymentId: "preview",
			}),
		).rejects.toThrow("Docker failed");
		expect(mocks.updateDeploymentStatus).toHaveBeenCalledWith(
			"deployment",
			"error",
		);
		expect(mocks.updatePreview).toHaveBeenLastCalledWith("preview", {
			previewStatus: "error",
		});
	});

	it("rejects a preview owned by a different service", async () => {
		mocks.findPreview.mockResolvedValue({ composeId: "another-compose" });
		await expect(
			deployPreviewCompose({
				composeId: "compose",
				previewDeploymentId: "preview",
			}),
		).rejects.toThrow("does not belong");
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it("removes containers when the PR closes during a build", async () => {
		const preview = await mocks.findPreview();
		mocks.findPreview
			.mockResolvedValueOnce(preview)
			.mockResolvedValueOnce(preview)
			.mockRejectedValue(
				Object.assign(new Error("Preview deleted"), { code: "NOT_FOUND" }),
			);
		await expect(
			deployPreviewCompose({
				composeId: "compose",
				previewDeploymentId: "preview",
			}),
		).rejects.toThrow("Preview deleted");
		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringMatching(
				/label\\?=com\.docker\.compose\.project\\?=preview-web/,
			),
		);
		expect(mocks.updatePreview).not.toHaveBeenCalledWith("preview", {
			previewStatus: "done",
		});
	});

	it("cleans only preview resources, even after the source provider changes", async () => {
		mocks.findCompose.mockResolvedValue({
			...(await mocks.findCompose()),
			sourceType: "raw",
		});
		await removePreviewCompose(await mocks.findPreview());
		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringMatching(
				/label\\?=com\.docker\.compose\.project\\?=preview-web/,
			),
		);
		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringMatching(
				/label\\?=com\.docker\.compose\.project\\?=preview-web/,
			),
		);
		expect(mocks.run.mock.calls[0]?.[0]).not.toContain("production");
		expect(mocks.run.mock.calls[0]?.[0]).not.toContain("docker compose");
		expect(mocks.run.mock.calls[0]?.[0]).not.toContain("compose.yml");
	});
	it("cleans a late build when deletion is marked but its row still exists", async () => {
		const original = await mocks.findPreview();
		mocks.findPreview
			.mockResolvedValueOnce(original)
			.mockResolvedValueOnce(original)
			.mockResolvedValue({ ...original, isDeleting: true });
		await expect(
			deployPreviewCompose({
				composeId: "compose",
				previewDeploymentId: "preview",
			}),
		).rejects.toThrow("deletion is in progress");
		expect(mocks.run).toHaveBeenCalledWith(
			expect.stringMatching(
				/label\\?=com\.docker\.compose\.project\\?=preview-web/,
			),
		);
		expect(mocks.updatePreview).not.toHaveBeenCalledWith("preview", {
			previewStatus: "done",
		});
	});

	it("does not start queued builds after deletion begins", async () => {
		mocks.findPreview.mockResolvedValue({
			...(await mocks.findPreview()),
			isDeleting: true,
		});
		await expect(
			deployPreviewCompose({
				composeId: "compose",
				previewDeploymentId: "preview",
			}),
		).rejects.toThrow("deletion is in progress");
		expect(mocks.run).not.toHaveBeenCalled();
		expect(mocks.createDeployment).not.toHaveBeenCalled();
	});
});
