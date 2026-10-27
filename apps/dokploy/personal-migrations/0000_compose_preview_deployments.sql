ALTER TABLE "preview_deployments" ALTER COLUMN "applicationId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewEnv" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewLabels" text[];--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewWildcard" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewServiceName" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewPort" integer DEFAULT 3000;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewHttps" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewPath" text DEFAULT '/';--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewCertificateType" "certificateType" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewCustomCertResolver" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewLimit" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "isPreviewDeploymentsActive" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "previewRequireCollaboratorPermissions" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "preview_deployments" ADD COLUMN "isDeleting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preview_deployments" ADD COLUMN "composeId" text;--> statement-breakpoint
ALTER TABLE "preview_deployments" ADD CONSTRAINT "preview_deployments_composeId_compose_composeId_fk" FOREIGN KEY ("composeId") REFERENCES "public"."compose"("composeId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_deployments" ADD CONSTRAINT "preview_deployment_service_check" CHECK (num_nonnulls("preview_deployments"."applicationId", "preview_deployments"."composeId") = 1);
