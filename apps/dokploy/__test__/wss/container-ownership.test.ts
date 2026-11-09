import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(
	() => new Map<unknown, { appName: string; serverId: string | null }>(),
);
const mockExec = vi.hoisted(() => vi.fn());
const mockPreview = vi.hoisted(() => vi.fn());
vi.mock("@dokploy/server/db", () => ({
	db: {
		query: { previewDeployments: { findFirst: mockPreview } },
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: async () => {
						const row = mockRows.get(table);
						return row ? [row] : [];
					},
				}),
			}),
		}),
	},
}));
vi.mock("@dokploy/server/utils/process/execAsync", () => ({
	execAsync: mockExec,
	execAsyncRemote: mockExec,
}));

import { applications, compose, libsql } from "@dokploy/server/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import { containerBelongsToService } from "@/server/wss/container-ownership";

const labels = (l: Record<string, string>) => ({ stdout: JSON.stringify(l) });

beforeEach(() => {
	vi.clearAllMocks();
	mockPreview.mockReset();
	mockRows.clear();
	mockRows.set(applications, { appName: "app-mine-abc123", serverId: null });
});

describe("containerBelongsToService", () => {
	it("allows compose preview containers only through their parent service", async () => {
		mockRows.clear();
		mockRows.set(compose, { appName: "parent-compose", serverId: "srv-1" });
		mockExec.mockResolvedValue(
			labels({ "com.docker.compose.project": "preview-one" }),
		);
		mockPreview.mockResolvedValue({ previewDeploymentId: "preview" });
		expect(await containerBelongsToService("parent-id", "c1", "srv-1")).toBe(
			true,
		);
		const query = new PgDialect().sqlToQuery(
			mockPreview.mock.calls[0]?.[0].where,
		);
		expect(query.params).toEqual(["parent-id", "preview-one", false]);
		mockPreview.mockResolvedValue(undefined);
		expect(
			await containerBelongsToService("other-parent-id", "c1", "srv-1"),
		).toBe(false);
	});
	it("rejects preview containers on another server or under an application", async () => {
		mockExec.mockResolvedValue(
			labels({ "com.docker.compose.project": "preview-one" }),
		);
		expect(await containerBelongsToService("app-id", "c1")).toBe(false);
		mockRows.clear();
		mockRows.set(compose, { appName: "parent-compose", serverId: "srv-1" });
		expect(await containerBelongsToService("parent-id", "c1", "srv-2")).toBe(
			false,
		);
		expect(mockPreview).not.toHaveBeenCalled();
	});
	it("allows a container of the service", async () => {
		mockExec.mockResolvedValue(
			labels({ "com.docker.swarm.service.name": "app-mine-abc123" }),
		);
		expect(await containerBelongsToService("svc", "c1")).toBe(true);
	});

	it("denies a container of another service", async () => {
		mockExec.mockResolvedValue(
			labels({ "com.docker.swarm.service.name": "dokploy" }),
		);
		expect(await containerBelongsToService("svc", "c1")).toBe(false);
	});

	it("denies containers without labels or when docker fails", async () => {
		mockExec.mockResolvedValue({ stdout: "null" });
		expect(await containerBelongsToService("svc", "c1")).toBe(false);
		mockExec.mockRejectedValue(new Error("No such object"));
		expect(await containerBelongsToService("svc", "c1")).toBe(false);
	});

	it("resolves libsql services", async () => {
		mockRows.clear();
		mockRows.set(libsql, { appName: "libsql-abc", serverId: null });
		mockExec.mockResolvedValue(
			labels({ "com.docker.swarm.service.name": "libsql-abc" }),
		);
		expect(await containerBelongsToService("svc", "c1")).toBe(true);
	});

	it("denies an unknown service", async () => {
		mockRows.clear();
		expect(await containerBelongsToService("nope", "c1")).toBe(false);
	});

	it("denies a server other than the service's", async () => {
		mockExec.mockResolvedValue(
			labels({ "com.docker.swarm.service.name": "app-mine-abc123" }),
		);
		expect(await containerBelongsToService("svc", "c1", "srv-other")).toBe(
			false,
		);
		mockRows.set(applications, {
			appName: "app-mine-abc123",
			serverId: "srv-1",
		});
		expect(await containerBelongsToService("svc", "c1")).toBe(false);
		expect(await containerBelongsToService("svc", "c1", "srv-1")).toBe(true);
	});

	describe("swarm tasks", () => {
		const swarm = (serviceSpec: object) =>
			mockExec
				.mockResolvedValueOnce({ stdout: "swarm-svc-id\n" })
				.mockResolvedValueOnce({ stdout: JSON.stringify(serviceSpec) });

		it("allows a task of the service", async () => {
			swarm({ Name: "app-mine-abc123" });
			expect(
				await containerBelongsToService("svc", "task1", null, "swarm"),
			).toBe(true);
		});

		it("allows a task of a stack the service deployed", async () => {
			swarm({
				Name: "app-mine-abc123_web",
				Labels: { "com.docker.stack.namespace": "app-mine-abc123" },
			});
			expect(
				await containerBelongsToService("svc", "task1", null, "swarm"),
			).toBe(true);
		});

		it("denies a task of another service", async () => {
			swarm({ Name: "dokploy" });
			expect(
				await containerBelongsToService("svc", "task1", null, "swarm"),
			).toBe(false);
		});

		it("denies a target that is not a task", async () => {
			mockExec.mockRejectedValue(new Error("No such task: dokploy"));
			expect(
				await containerBelongsToService("svc", "dokploy", null, "swarm"),
			).toBe(false);
		});
	});
});
