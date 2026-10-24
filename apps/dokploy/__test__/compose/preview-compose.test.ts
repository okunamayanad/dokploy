import { prepareComposePreview } from "@dokploy/server/utils/docker/compose/preview";
import type { ComposeSpecification } from "@dokploy/server/utils/docker/types";
import { describe, expect, it } from "vitest";

describe("Compose preview isolation", () => {
	const production: ComposeSpecification = {
		name: "production",
		services: {
			web: {
				build: ".",
				image: "production-web",
				container_name: "production-web",
				ports: ["3000:3000"],
				labels: [
					"traefik.http.routers.production.rule=Host(`production.example.com`)",
					"custom=value",
				],
				volumes: ["data:/data", "./public:/public:ro"],
				networks: ["shared"],
			},
			db: {
				image: "postgres:16",
				volumes: [{ type: "volume", source: "data", target: "/data" }],
			},
		},
		volumes: { data: { name: "production-data" } },
		networks: { shared: { external: true, name: "production-network" } },
	};

	it("isolates names, images, ports, volumes, networks and routes without changing production", () => {
		const original = structuredClone(production);
		const preview = prepareComposePreview(production, "preview-one");
		expect(production).toEqual(original);
		expect(preview.name).toBe("preview-one");
		expect(preview.services?.web).toMatchObject({
			image: "preview-one-web",
			labels: ["custom=value"],
			volumes: ["data:/data", "./public:/public:ro"],
		});
		expect(preview.services?.web).not.toHaveProperty("container_name");
		expect(preview.services?.web).not.toHaveProperty("ports");
		expect(preview.services?.db?.image).toBe("postgres:16");
		expect(preview.volumes?.data).not.toHaveProperty("name");
		expect(preview.networks?.shared).toEqual({});
	});

	it("is idempotent when rebuilding an existing preview", () => {
		const preview = prepareComposePreview(production, "preview-one");
		preview.networks = {
			...preview.networks,
			"preview-one": { name: "preview-one", external: true },
		};
		expect(prepareComposePreview(preview, "preview-one")).toEqual(preview);
	});

	it("removes map-style routing labels and keeps unrelated metadata", () => {
		const preview = prepareComposePreview(
			{
				services: {
					web: {
						labels: { "traefik.enable": "true", custom: "kept" },
						deploy: { labels: { "traefik.enable": "true", custom: "kept" } },
					},
				},
			},
			"preview-one",
		);
		expect(preview.services?.web?.labels).toEqual({ custom: "kept" });
		expect(preview.services?.web?.deploy?.labels).toEqual({ custom: "kept" });
	});

	it.each(["volumes", "configs", "secrets"] as const)(
		"rejects shared external %s",
		(kind) => {
			expect(() =>
				prepareComposePreview(
					{ [kind]: { shared: { external: true } } },
					"preview-one",
				),
			).toThrow("external resources");
		},
	);

	it.each([
		"/production:/data",
		"../production:/data",
		"${DATA_PATH}:/data",
		{ type: "bind", source: "/production", target: "/data" },
	])("rejects a bind outside the preview checkout: %j", (volume) => {
		expect(() =>
			prepareComposePreview(
				{ services: { db: { volumes: [volume] } } } as ComposeSpecification,
				"preview-one",
			),
		).toThrow("project-local bind mounts");
	});

	it("rejects host networking", () => {
		expect(() =>
			prepareComposePreview(
				{ services: { web: { network_mode: "host" } } },
				"preview-one",
			),
		).toThrow("network_mode");
	});
	it.each([
		{ include: ["production.yml"] },
		{
			services: {
				web: { extends: { file: "production.yml", service: "web" } },
			},
		},
	])("rejects unresolved Compose composition: %j", (specification) => {
		expect(() =>
			prepareComposePreview(
				specification as ComposeSpecification,
				"preview-one",
			),
		).toThrow(/include|extends/);
	});

	it.each([
		{
			driver: "local",
			driver_opts: { type: "none", o: "bind", device: "/production-data" },
		},
		{ driver: "nfs" },
	])("rejects host-backed/custom volume definitions: %j", (definition) => {
		expect(() =>
			prepareComposePreview({ volumes: { data: definition } }, "preview-one"),
		).toThrow("volume drivers");
	});

	it.each(["configs", "secrets"] as const)(
		"rejects external paths in %s",
		(kind) => {
			for (const file of [
				"/production/key",
				"../production/key",
				"${HOST_PATH}/key",
				"C:/production/key",
			]) {
				expect(() =>
					prepareComposePreview({ [kind]: { key: { file } } }, "preview-one"),
				).toThrow("project-local");
			}
			expect(
				prepareComposePreview(
					{ [kind]: { key: { file: "./config/key" } } },
					"preview-one",
				)[kind]?.key,
			).toEqual({ file: "./config/key" });
		},
	);
	it.each([
		"container:production-db:rw",
		"container:production-db:ro",
		"production-db",
		"${PRODUCTION_CONTAINER}",
	])("rejects external volumes_from: %s", (reference) => {
		expect(() =>
			prepareComposePreview(
				{ services: { web: { volumes_from: [reference] } } },
				"preview-one",
			),
		).toThrow("volumes_from");
	});

	it("keeps volume inheritance within the preview and anonymous volumes", () => {
		const result = prepareComposePreview(
			{
				services: {
					web: { volumes_from: ["db:ro"] },
					db: { volumes: ["/data"] },
				},
			},
			"preview-one",
		);
		expect(result.services?.web?.volumes_from).toEqual(["db:ro"]);
		expect(result.services?.db?.volumes).toEqual(["/data"]);
	});

	it.each(["routes.labels", ["routes.labels"]])(
		"rejects unresolved label files: %j",
		(label_file) => {
			expect(() =>
				prepareComposePreview(
					{ services: { web: { label_file } } },
					"preview-one",
				),
			).toThrow("label_file");
		},
	);

	it.each([
		"/production/.env",
		["/production/.env"],
		[{ path: "/production/.env", required: false }],
		["./local.env", { path: "../production/.env" }],
	])("rejects external env_file forms: %j", (env_file) => {
		expect(() =>
			prepareComposePreview({ services: { web: { env_file } } }, "preview-one"),
		).toThrow("env_file paths must be project-local");
	});

	it("keeps local env_file paths in string, list and long forms", () => {
		for (const env_file of [
			"./preview.env",
			["./preview.env"],
			[{ path: "./preview.env", required: false }],
		]) {
			expect(
				prepareComposePreview(
					{ services: { web: { env_file } } },
					"preview-one",
				).services?.web?.env_file,
			).toEqual(env_file);
		}
	});
	it("removes case-insensitive Traefik keys from arrays and maps", () => {
		const result = prepareComposePreview(
			{
				services: {
					web: {
						labels: [
							"Traefik.http.routers.production.rule=Host(`prod.example.com`)",
							"custom=kept",
						],
						deploy: { labels: { "TRAEFIK.ENABLE": "true", custom: "kept" } },
					},
				},
			},
			"preview-one",
		);
		expect(result.services?.web?.labels).toEqual(["custom=kept"]);
		expect(result.services?.web?.deploy?.labels).toEqual({ custom: "kept" });
	});

	it.each([
		[
			"${ROUTING_PREFIX:-traefik}.http.routers.production.rule=Host(`prod.example.com`)",
		],
		{ "${LABEL_KEY}": "value" },
	])(
		"rejects interpolated label keys before Compose expansion: %j",
		(labels) => {
			expect(() =>
				prepareComposePreview({ services: { web: { labels } } }, "preview-one"),
			).toThrow("interpolated label keys");
		},
	);

	it("permits environment interpolation in non-routing label values", () => {
		expect(
			prepareComposePreview(
				{ services: { web: { labels: ["custom=${VALUE}"] } } },
				"preview-one",
			).services?.web?.labels,
		).toEqual(["custom=${VALUE}"]);
	});
});
