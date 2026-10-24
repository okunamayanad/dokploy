import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getPreviewComposePaths,
	getPreviewPathValidationCommand,
} from "@dokploy/server/utils/docker/compose/preview-paths";
import type { ComposeSpecification } from "@dokploy/server/utils/docker/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe.skipIf(process.platform === "win32")(
	"Preview deployment-host path containment",
	() => {
		let directory: string;
		let checkout: string;
		let external: string;
		beforeEach(() => {
			directory = mkdtempSync(join(tmpdir(), "dokploy-preview-paths-"));
			checkout = join(directory, "checkout");
			external = join(directory, "production");
			mkdirSync(checkout);
			mkdirSync(external);
			writeFileSync(join(checkout, "compose.yml"), "services: {}\n");
			writeFileSync(
				join(external, "secret.env"),
				"PRODUCTION_SECRET=keep-out\n",
			);
			symlinkSync(
				join(external, "secret.env"),
				join(checkout, "production.env"),
			);
			symlinkSync(external, join(checkout, "production"));
		});
		afterEach(() => rmSync(directory, { recursive: true, force: true }));
		const validate = (specification: ComposeSpecification) =>
			execFileSync(
				"sh",
				[
					"-ec",
					getPreviewPathValidationCommand(
						checkout,
						getPreviewComposePaths(
							specification,
							join(checkout, "compose.yml"),
						),
					),
				],
				{ stdio: "pipe" },
			);

		it.each([
			{ services: { web: { env_file: "./production.env" } } },
			{
				services: {
					web: {
						env_file: [{ path: "./production/secret.env", required: false }],
					},
				},
			},
			{ services: { web: { volumes: ["./production:/data"] } } },
			{
				services: {
					web: {
						volumes: [{ type: "bind", source: "production", target: "/data" }],
					},
				},
			},
			{ configs: { key: { file: "./production.env" } } },
			{ secrets: { key: { file: "./production.env" } } },
			{ services: { web: { build: "./production" } } },
			{
				services: {
					web: {
						build: { context: ".", dockerfile: "./production/secret.env" },
					},
				},
			},
		])(
			"rejects symlink targets outside the actual checkout: %j",
			(specification) => {
				expect(() => validate(specification as ComposeSpecification)).toThrow();
			},
		);

		it("rejects a manifest symlink before the manifest can be overwritten", () => {
			rmSync(join(checkout, "compose.yml"));
			symlinkSync(join(external, "secret.env"), join(checkout, "compose.yml"));
			expect(() => validate({ services: {} })).toThrow();
		});

		it("rejects a generated .env path pointing into production", () => {
			symlinkSync(join(external, "secret.env"), join(checkout, ".env"));
			expect(() => validate({ services: {} })).toThrow();
		});

		it("allows local files, absent optional files and internal symlinks", () => {
			writeFileSync(join(checkout, "local.env"), "PREVIEW=true\n");
			symlinkSync("local.env", join(checkout, "local-link.env"));
			expect(() =>
				validate({
					services: {
						web: {
							env_file: [
								"./local-link.env",
								{ path: "./optional.env", required: false },
							],
						},
					},
				}),
			).not.toThrow();
		});

		it("quotes paths instead of interpreting shell metacharacters", () => {
			const file = join(checkout, "quote';touch injected;'.env");
			writeFileSync(file, "PREVIEW=true\n");
			expect(() =>
				execFileSync(
					"sh",
					["-ec", getPreviewPathValidationCommand(checkout, [file])],
					{ stdio: "pipe" },
				),
			).not.toThrow();
		});
	},
);
