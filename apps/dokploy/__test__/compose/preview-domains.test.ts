import * as schema from "@dokploy/server/db/schema";
import {
	apiUpdateCompose,
	previewDomainsSchema,
} from "@dokploy/server/db/schema/compose";
import type { Compose } from "@dokploy/server/services/compose";
import type { Domain } from "@dokploy/server/services/domain";
import {
	ensurePreviewTemplateDomains,
	generatePreviewWildcardDomain,
	getPreviewDomainLabel,
	isPrimaryPreviewDomain,
} from "@dokploy/server/services/preview-deployment";
import {
	addDomainToCompose,
	filterPreviewDomains,
	writeDomainsToCompose,
} from "@dokploy/server/utils/docker/domain";
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findPreview: vi.fn(),
	findCompose: vi.fn(),
	createDomain: vi.fn(),
	settings: vi.fn(),
}));
vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			previewDeployments: { findFirst: mocks.findPreview },
			patch: { findMany: vi.fn().mockResolvedValue([]) },
		},
	},
}));
vi.mock("@dokploy/server/services/compose", () => ({
	findComposeById: mocks.findCompose,
}));
vi.mock("@dokploy/server/services/domain", () => ({
	createDomain: mocks.createDomain,
}));
vi.mock("@dokploy/server/services/compose-preview", () => ({
	removePreviewCompose: vi.fn(),
}));
vi.mock("@dokploy/server/services/web-server-settings", () => ({
	getWebServerSettings: mocks.settings,
}));

const template = {
	serviceName: "api",
	port: 8080,
	path: "/",
	https: false,
	certificateType: "none" as const,
};
const domain = (
	domainId: string,
	serviceName: string,
	enabled = true,
): Domain =>
	({
		domainId,
		serviceName,
		host: `${domainId}.example.com`,
		port: 8080,
		path: "/",
		enabled,
		https: false,
		certificateType: "none",
		uniqueConfigKey: 1,
	}) as Domain;

beforeEach(() => vi.resetAllMocks());

describe("preview domain templates", () => {
	it("resolves primary and plural domain relations together", () => {
		expect(() =>
			drizzle
				.mock({ schema })
				.query.previewDeployments.findMany({
					with: { domain: true, domains: true },
				})
				.toSQL(),
		).not.toThrow();
	});
	it("validates ports, names, defaults and duplicate services", () => {
		expect(
			previewDomainsSchema.parse([{ ...template, path: undefined }])[0]?.path,
		).toBe("/");
		for (const value of [
			[{ ...template, serviceName: " " }],
			[{ ...template, port: 0 }],
			[{ ...template, port: 65536 }],
			[template, template],
		])
			expect(previewDomainsSchema.safeParse(value).success).toBe(false);
		expect(
			previewDomainsSchema.safeParse([{ ...template, port: 65535 }]).success,
		).toBe(true);
	});
	it("rejects a template for the primary service in compose updates", () => {
		expect(
			apiUpdateCompose.safeParse({
				composeId: "compose",
				previewServiceName: "api",
				previewDomains: [template],
			}).success,
		).toBe(false);
		expect(
			apiUpdateCompose.safeParse({
				composeId: "compose",
				previewServiceName: "web",
				previewDomains: [template],
			}).success,
		).toBe(true);
	});
	it("normalizes service slugs and truncates only the prefix", () => {
		expect(getPreviewDomainLabel("__API...Worker__", "preview-one")).toBe(
			"api-worker-preview-one",
		);
		expect(getPreviewDomainLabel("___", "preview-one")).toBe(
			"service-preview-one",
		);
		const label = getPreviewDomainLabel(
			"very-long-service-".repeat(10),
			"preview-one",
		);
		expect(label).toHaveLength(63);
		expect(label.endsWith("-preview-one")).toBe(true);
	});
	it("uses wildcard generation for ordinary and sslip.io template hosts", async () => {
		expect(
			await generatePreviewWildcardDomain(
				"*.example.com",
				"preview-one",
				"203.0.113.1",
				undefined,
				"API_worker",
			),
		).toBe("api-worker-preview-one.example.com");
		const host = await generatePreviewWildcardDomain(
			"*.sslip.io",
			"preview-one",
			"203.0.113.1",
			undefined,
			"api".repeat(50),
		);
		expect(host.split(".")[0]?.length).toBeLessThanOrEqual(63);
		expect(host.endsWith("-preview-one-203-0-113-1.sslip.io")).toBe(true);
		mocks.settings.mockResolvedValue({ serverIp: "192.0.2.3" });
		expect(
			await generatePreviewWildcardDomain(
				"*.sslip.io",
				"preview-one",
				"",
				undefined,
				"api",
			),
		).toBe("api-preview-one-192-0-2-3.sslip.io");
		expect(
			await generatePreviewWildcardDomain("*.example.com", "preview-one", ""),
		).toBe("preview-one.example.com");
	});
	it("only creates missing service domains and preserves edited and disabled domains", async () => {
		const edited = {
			...domain("edited", "api", false),
			host: "manual.example.com",
		};
		const preview = {
			previewDeploymentId: "preview",
			composeId: "compose",
			appName: "preview-one",
			domains: [domain("primary", "web"), edited],
		};
		mocks.findPreview.mockResolvedValue(preview);
		mocks.findCompose.mockResolvedValue({
			previewWildcard: "*.example.com",
			previewDomains: [template, { ...template, serviceName: "worker" }],
			server: { ipAddress: "203.0.113.1" },
		});
		mocks.createDomain.mockImplementation(async (input) => {
			const created = { ...domain("created", input.serviceName), ...input };
			preview.domains.push(created);
			return created;
		});
		await ensurePreviewTemplateDomains("preview");
		await ensurePreviewTemplateDomains("preview");
		expect(mocks.createDomain).toHaveBeenCalledTimes(1);
		expect(mocks.createDomain).toHaveBeenCalledWith({
			...template,
			serviceName: "worker",
			host: "worker-preview-one.example.com",
			domainType: "preview",
			previewDeploymentId: "preview",
		});
		expect(preview.domains[1]).toEqual(edited);
	});
	it("leaves application previews alone", async () => {
		mocks.findPreview.mockResolvedValue({
			applicationId: "application",
			domains: [],
		});
		await ensurePreviewTemplateDomains("preview");
		expect(mocks.findCompose).not.toHaveBeenCalled();
		expect(mocks.createDomain).not.toHaveBeenCalled();
	});
	it("detects primary domain references", async () => {
		mocks.findPreview
			.mockResolvedValueOnce({ previewDeploymentId: "preview" })
			.mockResolvedValueOnce(undefined);
		expect(await isPrimaryPreviewDomain("primary")).toBe(true);
		expect(await isPrimaryPreviewDomain("secondary")).toBe(false);
	});
});

describe("missing preview services", () => {
	const primary = domain("primary", "web");
	const missing = domain("missing", "removed");
	const compose = {
		composeId: "compose",
		appName: "preview-one",
		sourceType: "raw",
		composeType: "docker-compose",
		composeFile: "services:\n  web:\n    image: nginx\n",
		previewDeploymentId: "preview",
		previewPrimaryDomainId: "primary",
	} as Compose & {
		previewDeploymentId: string;
		previewPrimaryDomainId: string;
	};
	it("filters secondary missing services and keeps the primary for validation", () => {
		const warn = vi.fn();
		expect(
			filterPreviewDomains(
				[primary, missing],
				{ services: { web: {} } },
				"primary",
				warn,
			),
		).toEqual([primary]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('service "removed"'),
		);
		expect(
			filterPreviewDomains([primary], { services: {} }, "primary", warn),
		).toEqual([primary]);
	});
	it("logs skipped secondary domains in the deployment command", async () => {
		const command = await writeDomainsToCompose(compose, [primary, missing]);
		expect(command).toContain("Warning: skipping preview domain");
		expect(command).not.toContain("Has occurred an error");
		expect(command).toContain("base64 -d");
	});
	it("still fails for a missing primary or a missing non-preview service", async () => {
		await expect(
			addDomainToCompose({ ...compose, previewPrimaryDomainId: "missing" }, [
				missing,
			]),
		).rejects.toThrow("does not exist");
		await expect(
			addDomainToCompose({ ...compose, previewDeploymentId: undefined }, [
				missing,
			]),
		).rejects.toThrow('service "removed"');
	});
});
