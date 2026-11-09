import { z } from "zod";

export const previewDomainTemplateSchema = z.object({
	serviceName: z.string().trim().min(1),
	port: z.number().int().min(1).max(65535),
	path: z.string().default("/"),
	https: z.boolean(),
	certificateType: z.enum(["letsencrypt", "none", "custom"]),
	customCertResolver: z.string().nullable().optional(),
});
export type PreviewDomainTemplate = z.infer<typeof previewDomainTemplateSchema>;
export const previewDomainsSchema = z
	.array(previewDomainTemplateSchema)
	.superRefine((templates, ctx) => {
		const names = new Set<string>();
		for (const [index, template] of templates.entries()) {
			if (names.has(template.serviceName))
				ctx.addIssue({
					code: "custom",
					path: [index, "serviceName"],
					message: "Service names must be unique",
				});
			names.add(template.serviceName);
		}
	});
export const validatePreviewDomainPrimary = (
	input: {
		previewServiceName?: string | null;
		previewDomains?: PreviewDomainTemplate[];
	},
	ctx: z.RefinementCtx,
) => {
	for (const [index, template] of (input.previewDomains ?? []).entries()) {
		if (template.serviceName === input.previewServiceName)
			ctx.addIssue({
				code: "custom",
				path: ["previewDomains", index, "serviceName"],
				message:
					"Additional domains must use a different service than the primary",
			});
	}
};
