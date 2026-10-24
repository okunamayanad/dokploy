import { relations, sql } from "drizzle-orm";
import { boolean, check, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { applications } from "./application";
import { compose } from "./compose";
import { deployments } from "./deployment";
import { domains } from "./domain";
import { applicationStatus } from "./shared";
import { generateAppName } from "./utils";

export const previewDeployments = pgTable(
	"preview_deployments",
	{
		previewDeploymentId: text("previewDeploymentId")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		branch: text("branch").notNull(),
		pullRequestId: text("pullRequestId").notNull(),
		pullRequestNumber: text("pullRequestNumber").notNull(),
		pullRequestURL: text("pullRequestURL").notNull(),
		pullRequestTitle: text("pullRequestTitle").notNull(),
		pullRequestCommentId: text("pullRequestCommentId").notNull(),
		previewStatus: applicationStatus("previewStatus").notNull().default("idle"),
		isDeleting: boolean("isDeleting").notNull().default(false),
		appName: text("appName")
			.notNull()
			.$defaultFn(() => generateAppName("preview"))
			.unique(),
		applicationId: text("applicationId").references(
			() => applications.applicationId,
			{
				onDelete: "cascade",
			},
		),
		composeId: text("composeId").references(() => compose.composeId, {
			onDelete: "cascade",
		}),
		domainId: text("domainId").references(() => domains.domainId, {
			onDelete: "cascade",
		}),
		createdAt: text("createdAt")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		expiresAt: text("expiresAt"),
	},
	(table) => [
		check(
			"preview_deployment_service_check",
			sql`num_nonnulls(${table.applicationId}, ${table.composeId}) = 1`,
		),
	],
);

export const previewDeploymentsRelations = relations(
	previewDeployments,
	({ one, many }) => ({
		deployments: many(deployments),
		domain: one(domains, {
			fields: [previewDeployments.domainId],
			references: [domains.domainId],
		}),
		application: one(applications, {
			fields: [previewDeployments.applicationId],
			references: [applications.applicationId],
		}),
		compose: one(compose, {
			fields: [previewDeployments.composeId],
			references: [compose.composeId],
		}),
	}),
);

export const createSchema = createInsertSchema(previewDeployments, {
	applicationId: z.string(),
});

export const apiCreatePreviewDeployment = z.object({
	applicationId: z.string().min(1),
	domainId: z.string().optional(),
	branch: z.string().min(1),
	pullRequestId: z.string().min(1),
	pullRequestNumber: z.string().min(1),
	pullRequestURL: z.string().min(1),
	pullRequestTitle: z.string().min(1),
});
