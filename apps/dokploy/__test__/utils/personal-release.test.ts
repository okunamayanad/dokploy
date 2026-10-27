import {
	comparePersonalVersions,
	fetchPersonalUpdate,
	PERSONAL_IMAGE,
	PERSONAL_MANIFEST_URL,
	parsePersonalVersion,
} from "@dokploy/server/utils/personal-release";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("personal releases", () => {
	it.each([
		["v1.0.0.2", "v1.0.0.1", 1],
		["v1.0.1.0", "v1.0.0.99", 1],
		["v1.0.0.10", "v1.0.0.9", 1],
		["v1.0.0.0", "1.0.0.0", 0],
		["v1.0.0.1", "v1.0.1.0", -1],
	])("orders %s against %s", (a, b, expected) => {
		expect(comparePersonalVersions(a, b)).toBe(expected);
	});
	it.each([
		"v1.2.3",
		"latest",
		"v1.2.3.4;id",
		"v1.2.3.-1",
		"v01.2.3.4",
		"v1.2.3.9007199254740992",
	])("rejects %s", (version) => {
		expect(() => parsePersonalVersion(version)).toThrow();
	});
	it("uses only the fork's published manifest and pinned image", async () => {
		const image = `${PERSONAL_IMAGE}:v1.0.1.0@sha256:${"a".repeat(64)}`;
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ version: "v1.0.1.0", image })),
			);
		vi.stubGlobal("fetch", fetch);
		expect(await fetchPersonalUpdate("v1.0.0.9")).toEqual({
			latestVersion: "v1.0.1.0",
			updateAvailable: true,
			image,
		});
		expect(fetch).toHaveBeenCalledWith(
			PERSONAL_MANIFEST_URL,
			expect.any(Object),
		);
	});
	it.each([
		"dokploy/dokploy:v1.0.0.1",
		`${PERSONAL_IMAGE}:v1.0.0.1`,
		`${PERSONAL_IMAGE}:v1.0.0.2@sha256:${"a".repeat(64)}`,
	])("rejects an untrusted or mismatched image %s", async (image) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ version: "v1.0.0.1", image })),
				),
		);
		await expect(fetchPersonalUpdate("v1.0.0.0")).rejects.toThrow();
	});
	it("reports a lookup failure instead of claiming the server is up to date", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("", { status: 503 })),
		);
		await expect(fetchPersonalUpdate("v1.0.0.0")).rejects.toThrow("HTTP 503");
	});
	it("does not downgrade", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(
						JSON.stringify({
							version: "v1.0.0.1",
							image: `${PERSONAL_IMAGE}:v1.0.0.1@sha256:${"a".repeat(64)}`,
						}),
					),
				),
		);
		expect((await fetchPersonalUpdate("v1.0.1.0")).updateAvailable).toBe(false);
	});
});
