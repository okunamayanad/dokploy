# Compose preview validation

Tested on 2026-10-24 using Docker Desktop's Linux engine, a separate Docker 28
DinD daemon, PostgreSQL 16 and Node 24.22.1. All application workloads were inside
the disposable nested daemon; the host Docker socket was not mounted into Dokploy.

Verified with the actual application and PostgreSQL:

- Fresh installation, migrations, account, organization and provider setup.
- Signed `pull_request` HTTP webhook starts the deployment queue.
- PR ref checkout from a real HTTPS Git server, image build and HTTP routing.
- Two simultaneous previews with distinct names, routes, images, volumes and
  networks; production host ports are not published by previews.
- Separate preview environment variables. The production container ID and named
  volume sentinel were unchanged throughout preview creation and updates.
- New previews stop at the configured limit. Existing previews still update at
  the limit and keep their URLs. Rebuild uses cached code.
- Collaborator authorization and PR label filters block ineligible requests.
- GitHub fixture comments move through building/success states.
- PR close removes containers, volume, network, code, logs and database record.
- A separately authenticated owner of another organization cannot list, inspect,
  rebuild or delete the previews, or alter their parent Compose settings.

Verified through the browser:

- Compose Preview Deployments tab loads and displays real database records.
- Configure opens with the stored service, wildcard, port and limit; Save calls
  `compose.update` successfully.
- Rebuild confirmation queues a real rebuild and returns to `done`.
- Editing the preview host, then rebuilding, changes the working HTTP route.
- Delete removes the real preview even when its Compose file has been moved;
  project-label cleanup leaves production running.

Linux regression run: **310 tests passed in 45 files**, including the Compose,
GitHub webhook, GitHub cloning and deployment queue suites. Workspace TypeScript
checks passed. Windows has an existing path-separator mismatch in one Compose
test; that same test passes inside Linux.

The GitHub API and webhook sender are local fixtures. No real GitHub account or
repository was modified. Remote-server execution is unit-tested, not exercised
through a real SSH host. Podman was detected running; this integration run used
Docker because Dokploy requires Docker Swarm.

GPT-6 Astra medium review round 1 identified four issues: unvalidated YAML used
during cleanup, unresolved include/extends bypasses, host-backed volume/resource
definitions, and a close/build race. All four were confirmed and addressed:

- Cleanup now only selects Docker resources by the preview project label and its
  generated network name, without executing checkout YAML.
- Unsupported include/extends directives and host-backed resource definitions are
  rejected before deployment.
- A persistent `isDeleting` marker is set before Docker cleanup. Queued builds
  refuse it; active builds clean up when they see the marker or a missing row.
- Added focused regression coverage for these paths and both close/build row
  orderings. The full scenario was repeated on a fresh database and nested engine.

The real Docker destructive regression run also passed all seven scenarios:
six rejected/invalid manifests were deleted while an unused production volume
retained its sentinel, and closing a PR during a slow real image build left no
orphan containers, volumes or network. The other preview and production remained
running. Cross-organization access checks passed again after the fresh install.

Round 2 found external `volumes_from`, `label_file`, and outside-project
`env_file` paths bypassed the intended separation. These were confirmed and fixed.
Volume inheritance now only accepts services in the same preview; label files
are rejected; all env-file forms validate their paths. Anonymous container
volumes are supported and removed with `docker rm -v`. Added twelve focused
cases and reran the Linux regression suite successfully.

The expanded destructive suite passed **ten scenarios**: nine invalid/unsafe
Compose definitions (including all round 2 findings) plus a new uncached slow-build
PR-close race. No preview resources were left behind and the protected volume,
other preview and production sentinel were preserved.

Round 3 found case/interpolation variants of Traefik label keys and symlink-based
file escapes. Both were confirmed and addressed. Labels are filtered without
case sensitivity and interpolated keys are rejected. Deployment-host `realpath`
guards enforce checkout containment for manifests, generated env files, env-file
sources, binds, configs/secrets, build paths and preview patch destinations.
New Linux tests exercise real symlinks, including attempts to redirect manifest
and generated `.env` writes outside the checkout.

Latest real Docker regression suite: **15 scenarios passed** (14 rejected
definitions, including real Git symlinks and interpolated routing keys, plus the
uncached build/PR-close race). A normal existing preview rebuild and HTTP response
also passed after the deployment-host path guard was enabled.

Round 4 **GPT-6 Astra, medium**: **no verified actionable findings**. It reviewed
isolation/path guards, cleanup/build races, webhook authorization/lifecycle, fork
checkout, queue/cloud dispatch, migration, API access, UI and application-preview
compatibility. All nine findings from rounds 1–3 were confirmed and fixed before
this clean review. The reviewer performed a read-only review and inspected the
test evidence; it did not rerun live integration or GitHub/SSH tests.

Final verification: 310 Linux tests in 45 files, 15 real Docker regression
scenarios, normal preview rebuild/HTTP routing, all workspace typechecks and
Biome checks on changed sources passed. The browser automation tab was explicitly
closed and closure verified. The disposable test installation was stopped before
the user-requested computer shutdown; its volumes were retained for inspection.
Temporary verification logs are under the ignored workspace directory
`.docker/verification/`.
