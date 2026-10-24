import { join } from "node:path";
import { paths } from "@dokploy/server/constants";
import { TRPCError } from "@trpc/server";
import { quote } from "shell-quote";
import { getBuildComposeCommand } from "../utils/builders/compose";
import { encodeBase64 } from "../utils/docker/utils";
import { execAsync, execAsyncRemote } from "../utils/process/execAsync";
import { cloneGithubRepository } from "../utils/providers/github";
import { type Compose, findComposeById } from "./compose";
import { createDeploymentPreview, updateDeploymentStatus } from "./deployment";
import {
	createPreviewDeploymentComment,
	getIssueComment,
	issueCommentExists,
	updateIssueComment,
} from "./github";
import { generateApplyPatchesCommand } from "./patch";
import {
	findPreviewDeploymentById,
	type PreviewDeployment,
	updatePreviewDeployment,
} from "./preview-deployment";

export const getPreviewCompose = async (
	composeId: string,
	previewDeploymentId: string,
) => {
	const [compose, preview] = await Promise.all([
		findComposeById(composeId),
		findPreviewDeploymentById(previewDeploymentId),
	]);
	if (
		preview.composeId !== composeId ||
		compose.sourceType !== "github" ||
		compose.composeType !== "docker-compose"
	) {
		throw new Error(
			"Preview does not belong to this Docker Compose application",
		);
	}
	if (preview.isDeleting)
		throw new TRPCError({
			code: "CONFLICT",
			message: "Preview deletion is in progress",
		});
	return {
		...compose,
		appName: preview.appName,
		branch: preview.branch,
		env: `${compose.previewEnv || ""}\nDOKPLOY_DEPLOY_URL=${preview.domain?.host || ""}`,
		command: "",
		randomize: false,
		suffix: preview.appName,
		isolatedDeployment: true,
		isolatedDeploymentsVolume: false,
		mounts: [],
		serviceNetworks: [],
		domains: preview.domain ? [preview.domain] : [],
		previewDeploymentId,
	};
};

export const deployPreviewCompose = async ({
	composeId,
	previewDeploymentId,
	titleLog = "Preview Deployment",
	descriptionLog = "",
	rebuild = false,
}: {
	composeId: string;
	previewDeploymentId: string;
	titleLog?: string;
	descriptionLog?: string;
	rebuild?: boolean;
}) => {
	const compose = await getPreviewCompose(composeId, previewDeploymentId);
	const preview = await findPreviewDeploymentById(previewDeploymentId);
	const run = (command: string) =>
		compose.serverId
			? execAsyncRemote(compose.serverId, command)
			: execAsync(command);
	const previewDomain = `${preview.domain?.https ? "https" : "http"}://${preview.domain?.host}${preview.domain?.path || "/"}`;
	const issueParams = {
		owner: compose.owner || "",
		repository: compose.repository || "",
		githubId: compose.githubId || "",
		issue_number: preview.pullRequestNumber,
		comment_id: Number.parseInt(preview.pullRequestCommentId, 10),
	};
	const comment = async (state: "running" | "success" | "error") => {
		try {
			if (!(await issueCommentExists(issueParams))) {
				const replacement = await createPreviewDeploymentComment({
					...issueParams,
					previewDomain,
					appName: compose.name,
					previewDeploymentId,
				});
				if (replacement)
					issueParams.comment_id = Number.parseInt(
						replacement.pullRequestCommentId,
						10,
					);
			}
			await updateIssueComment({
				...issueParams,
				body: `### Dokploy Preview Deployment\n\n${getIssueComment(compose.name, state, previewDomain)}`,
			});
		} catch (error) {
			console.error("Could not update preview deployment comment", error);
		}
	};
	await updatePreviewDeployment(previewDeploymentId, {
		previewStatus: "running",
	});
	const deployment = await createDeploymentPreview({
		previewDeploymentId,
		title: titleLog,
		description: descriptionLog,
	});
	const runLogged = (command: string) =>
		run(`(${command}) >> ${quote([deployment.logPath])} 2>&1`);
	try {
		await comment("running");
		if (!rebuild) {
			await runLogged(
				await cloneGithubRepository({
					...compose,
					type: "compose",
					pullRequestNumber: preview.pullRequestNumber,
				}),
			);
		}
		await runLogged(
			`set -e;${await generateApplyPatchesCommand({ id: composeId, type: "compose", serverId: compose.serverId, appName: compose.appName, confineToCodeDirectory: true })}`,
		);
		await runLogged(await getBuildComposeCommand(compose));
		// The tombstone is set before deletion starts, so a still-existing row
		// cannot allow a late build to escape the close handler's cleanup.
		if ((await findPreviewDeploymentById(previewDeploymentId)).isDeleting) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "Preview deletion is in progress",
			});
		}
		await updateDeploymentStatus(deployment.deploymentId, "done");
		await updatePreviewDeployment(previewDeploymentId, {
			previewStatus: "done",
		});
		await comment("success");
	} catch (error) {
		let deleted = false;
		try {
			deleted = (await findPreviewDeploymentById(previewDeploymentId))
				.isDeleting;
		} catch (lookupError) {
			if (
				lookupError instanceof Error &&
				"code" in lookupError &&
				lookupError.code === "NOT_FOUND"
			) {
				deleted = true;
			}
		}
		if (deleted) {
			await removePreviewCompose(preview, compose);
			throw error;
		}
		await updateDeploymentStatus(deployment.deploymentId, "error");
		await updatePreviewDeployment(previewDeploymentId, {
			previewStatus: "error",
		});
		await run(
			`echo ${quote([encodeBase64(error instanceof Error ? error.message : String(error))])} | base64 -d >> ${quote([deployment.logPath])}`,
		).catch(console.error);
		await comment("error");
		throw error;
	}
};

export const removePreviewCompose = async (
	preview: PreviewDeployment,
	source?: Compose,
) => {
	if (!preview.composeId) throw new Error("Compose preview required");
	const compose = {
		...(source ?? (await findComposeById(preview.composeId))),
		appName: preview.appName,
	};
	const { COMPOSE_PATH } = paths(!!compose.serverId);
	const projectFilter = quote([
		`label=com.docker.compose.project=${preview.appName}`,
	]);
	// Never interpret checkout YAML during cleanup: validation may have failed
	// before it was sanitized, and explicit names can refer to production data.
	const command = `set -e;
containers=$(docker ps -aq --filter ${projectFilter});
if [ -n "$containers" ]; then printf '%s\n' "$containers" | xargs -r docker rm -fv; fi;
volumes=$(docker volume ls -q --filter ${projectFilter});
if [ -n "$volumes" ]; then printf '%s\n' "$volumes" | xargs -r docker volume rm; fi;
docker network disconnect ${quote([preview.appName])} dokploy-traefik >/dev/null 2>&1 || true;
networks=$(docker network ls -q --filter ${projectFilter});
if [ -n "$networks" ]; then printf '%s\n' "$networks" | xargs -r docker network rm; fi;
docker network rm ${quote([preview.appName])} >/dev/null 2>&1 || true;
rm -rf ${quote([join(COMPOSE_PATH, preview.appName)])};`;
	if (compose.serverId) await execAsyncRemote(compose.serverId, command);
	else await execAsync(command);
};
