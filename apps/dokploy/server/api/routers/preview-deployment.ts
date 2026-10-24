import {
	findApplicationById,
	findComposeById,
	findPreviewDeploymentById,
	findPreviewDeploymentsByApplicationId,
	findPreviewDeploymentsByComposeId,
	IS_CLOUD,
	removePreviewDeployment,
} from "@dokploy/server";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import { apiFindAllByApplication } from "@/server/db/schema";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const previewDeploymentRouter = createTRPCRouter({
	all: protectedProcedure
		.input(
			z.union([
				apiFindAllByApplication,
				z.object({ composeId: z.string().min(1) }),
			]),
		)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(
				ctx,
				"composeId" in input ? input.composeId : input.applicationId,
				{
					deployment: ["read"],
				},
			);
			return "composeId" in input
				? findPreviewDeploymentsByComposeId(input.composeId)
				: findPreviewDeploymentsByApplicationId(input.applicationId);
		}),

	one: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string() }))
		.query(async ({ input, ctx }) => {
			const previewDeployment = await findPreviewDeploymentById(
				input.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(
				ctx,
				(previewDeployment.applicationId || previewDeployment.composeId)!,
				{ deployment: ["read"] },
			);
			return previewDeployment;
		}),

	delete: protectedProcedure
		.input(z.object({ previewDeploymentId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const previewDeployment = await findPreviewDeploymentById(
				input.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(
				ctx,
				(previewDeployment.applicationId || previewDeployment.composeId)!,
				{ deployment: ["cancel"] },
			);
			myQueue.removeWaiting(
				(data) =>
					"previewDeploymentId" in data &&
					data.previewDeploymentId === input.previewDeploymentId,
			);
			await removePreviewDeployment(input.previewDeploymentId);
			await audit(ctx, {
				action: "delete",
				resourceType: "previewDeployment",
				resourceId: input.previewDeploymentId,
			});
			return true;
		}),

	redeploy: protectedProcedure
		.input(
			z.object({
				previewDeploymentId: z.string(),
				title: z.string().optional(),
				description: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const previewDeployment = await findPreviewDeploymentById(
				input.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(
				ctx,
				(previewDeployment.applicationId || previewDeployment.composeId)!,
				{ deployment: ["create"] },
			);
			const application = previewDeployment.composeId
				? await findComposeById(previewDeployment.composeId)
				: await findApplicationById(previewDeployment.applicationId!);
			const jobData: DeploymentJob = {
				...(previewDeployment.composeId
					? {
							composeId: previewDeployment.composeId,
							applicationType: "compose-preview" as const,
						}
					: {
							applicationId: previewDeployment.applicationId!,
							applicationType: "application-preview" as const,
						}),
				titleLog: input.title || "Rebuild Preview Deployment",
				descriptionLog: input.description || "",
				type: "redeploy",
				previewDeploymentId: input.previewDeploymentId,
				server: !!application.serverId,
				serverId: application.serverId ?? undefined,
			};

			if (IS_CLOUD && application.serverId) {
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				await audit(ctx, {
					action: "redeploy",
					resourceType: "previewDeployment",
					resourceId: input.previewDeploymentId,
				});
				return true;
			}
			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
			await audit(ctx, {
				action: "redeploy",
				resourceType: "previewDeployment",
				resourceId: input.previewDeploymentId,
			});
			return true;
		}),
});
