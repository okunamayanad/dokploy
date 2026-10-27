# Personal Dokploy distribution

Develop on `personal`. `main`/`canary` remain upstream tracking branches; there is no patch application step.
The first release includes Compose PR previews plus upstream canary development through `d18c1102a`, merged with stable `v0.30.10`.

## Releases

`packages/server/src/personal-release.json` is the authoritative distribution version and source metadata.
`vX.Y.Z.D` means upstream stable `vX.Y.Z`, personal revision `D`. Revision zero already contains personal changes.
The app package retains upstream's three-part version for package tooling. The UI, update checks, image tags and releases use the four-part version.

For another personal release on the same upstream base:

```sh
node scripts/personal/version.mjs bump
git add packages/server/src/personal-release.json
git commit -m 'chore(personal): prepare next release'
git push origin personal
```

Every push runs verification; a version not yet released also builds native amd64 and arm64 images, smoke-tests the packaged app, and publishes the release.
Published version tags must never be moved or rebuilt. Fixes get a new personal revision.
GitHub release assets include `release.json` (image digest and provenance), a version-pinned installer and `SHA256SUMS`.
The updater reads only this fork's latest published release manifest. Drafts, failed builds and upstream releases do not become update candidates.
The GHCR package must be public for unauthenticated server pulls; verify this before first installation. Publishing an image does not install it anywhere.

## Upstream integration

The scheduled Personal upstream sync workflow checks stable releases every six hours and opens an integration PR.
It merges the new upstream tag, resets the personal revision to zero, and dispatches verification. Conflict PRs need manual resolution and a metadata update:

```sh
node scripts/personal/version.mjs upstream vX.Y.Z
```

Review and merge the integration PR; the `personal` push publishes a tested fork release. Server installation remains a separate action.
Never merge an integration PR with a stale version file or failing verification.

## Database history

Keep `apps/dokploy/drizzle` and its snapshots/journal aligned with upstream. Personal SQL lives in `apps/dokploy/personal-migrations`, with its own journal and `drizzle.__personal_migrations` ledger.
Startup runs upstream migrations first, then personal migrations. Append personal migrations; never edit SQL that has been released.
Author personal SQL and journal entries explicitly; do not run the upstream schema generator against the combined fork schema and commit its output to the upstream chain.
Future upstream changes to the same tables still require semantic review, even if Git merges cleanly.
The original preview branch's unpublished `0198_compose_preview_deployments` moved to this personal chain. An installation that already applied that experimental migration needs a separately planned migration-ledger transition; do not use the standard installer update on it.

## Installation / upgrade

Use the `install.sh` attached to the chosen personal release, not `dokploy.com/install.sh`.
For a fresh Linux server: download and inspect it, then `sudo bash install.sh`.
For an existing upstream installation: back up PostgreSQL and `/etc/dokploy`, then `sudo bash install.sh update`.
The update subcommand changes the existing `dokploy` Swarm service image; it does not reinstall Docker, databases or Traefik.
Existing application data and credentials stay mounted as before. Check the source version and any skipped upstream migration requirements before production upgrades.
For later versions, the in-panel Update action follows this fork automatically. Do not run an external upstream auto-updater against these instances.
Image rollback does not undo database migrations. Restore a matching database backup when a downgrade requires it.
