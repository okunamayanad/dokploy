import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "@dokploy/server/db";
import { account, member, organization, user } from "@dokploy/server/db/schema";
import { hash } from "bcrypt";

const state = JSON.parse(readFileSync(".docker/fixture/state.json", "utf8"));
const result = JSON.parse(readFileSync(".docker/fixture/result.json", "utf8"));
const now = new Date();
await db
	.insert(user)
	.values({
		id: "integration-outsider",
		email: "outsider@example.test",
		emailVerified: true,
		firstName: "Other",
		lastName: "Organization",
		updatedAt: now,
	})
	.onConflictDoNothing();
await db
	.insert(account)
	.values({
		id: "integration-outsider-account",
		userId: "integration-outsider",
		accountId: "integration-outsider",
		providerId: "credential",
		password: await hash(state.token, 10),
		createdAt: now,
		updatedAt: now,
	})
	.onConflictDoNothing();
await db
	.insert(organization)
	.values({
		id: "integration-other-org",
		name: "Other Organization",
		ownerId: "integration-outsider",
		createdAt: now,
	})
	.onConflictDoNothing();
await db
	.insert(member)
	.values({
		id: "integration-other-member",
		userId: "integration-outsider",
		organizationId: "integration-other-org",
		role: "owner",
		isDefault: true,
		createdAt: now,
	})
	.onConflictDoNothing();
const login = await fetch("http://localhost:3000/api/auth/sign-in/email", {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		Origin: "http://localhost:3000",
	},
	body: JSON.stringify({
		email: "outsider@example.test",
		password: state.token,
	}),
});
assert.equal(login.status, 200, await login.text());
const cookie = login.headers
	.getSetCookie()
	.map((c) => c.split(";")[0])
	.join("; ");
assert.ok(cookie);
const session = await fetch("http://localhost:3000/api/auth/get-session", {
	headers: { Cookie: cookie },
}).then((r) => r.json());
assert.equal(session.user?.email, "outsider@example.test");
assert.equal(session.session?.activeOrganizationId, "integration-other-org");
const previewId = result.previewDeploymentId;
for (const [procedure, input, mutation] of [
	["previewDeployment.all", { composeId: "integration-compose" }, false],
	["previewDeployment.one", { previewDeploymentId: previewId }, false],
	["previewDeployment.redeploy", { previewDeploymentId: previewId }, true],
	["previewDeployment.delete", { previewDeploymentId: previewId }, true],
	[
		"compose.update",
		{ composeId: "integration-compose", isPreviewDeploymentsActive: false },
		true,
	],
] as const) {
	const payload = JSON.stringify({ json: input });
	const response = await fetch(
		`http://localhost:3000/api/trpc/${procedure}${mutation ? "" : `?input=${encodeURIComponent(payload)}`}`,
		{
			method: mutation ? "POST" : "GET",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			...(mutation ? { body: payload } : {}),
		},
	);
	assert.ok(
		[401, 403].includes(response.status),
		`${procedure}: expected access denial, got ${response.status} ${await response.text()}`,
	);
	console.log(
		`PASS Cross-organization ${procedure} rejected (${response.status})`,
	);
}
process.exit(0);
