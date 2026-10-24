# Isolated Compose preview installation

Run from the repository root after starting Docker Desktop with Linux containers:

```sh
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml up --build -d
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml logs -f app
```

The application runs at http://localhost:13000. Traefik is available on
http://localhost:13080 (use the preview domain as the HTTP `Host` header).
PostgreSQL, application data and a nested Docker engine use disposable volumes.
The installation does not mount the host's Docker socket. All Swarm, Traefik,
application and preview resources are created inside the nested engine.

The local HTTPS GitHub fixture serves installation tokens, collaborator responses,
PR comments and a real Git repository with `refs/pull/*/head`. It never sends
requests or comments to GitHub. Run the automated integration scenario:

```sh
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml exec -e NODE_EXTRA_CA_CERTS=/workspace/apps/dokploy/.docker/fixture/cert.pem -e GIT_SSL_CAINFO=/workspace/apps/dokploy/.docker/fixture/cert.pem app pnpm exec tsx scripts/compose-preview-test/integration.ts
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml exec app pnpm exec tsx scripts/compose-preview-test/access.ts
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml exec -e NODE_EXTRA_CA_CERTS=/workspace/apps/dokploy/.docker/fixture/cert.pem -e GIT_SSL_CAINFO=/workspace/apps/dokploy/.docker/fixture/cert.pem app pnpm exec tsx scripts/compose-preview-test/regressions.ts
```

Start with fresh test volumes for a repeat run: the scenario intentionally changes
PR 101 and closes PR 102. The generated fixture credentials remain inside the
disposable `app-data` volume. The application account is `preview@example.test`;
its generated password is the `token` value in `.docker/fixture/state.json` inside
the app container. Do not reuse this account or its credentials elsewhere.

This validates real PostgreSQL migrations, authentication, webhook verification,
job processing, Git checkout, image builds, volumes, routing and deletion.
GitHub API behavior is simulated; remote-server SSH execution is covered by unit
tests. To also test live GitHub delivery, connect a disposable repository's GitHub
App and forward its pull request webhooks to port 13000 through a tunnel.

In a **GitHub → Docker Compose** service, open **Preview Deployments → Configure**.
Choose the Compose service to expose, its port, a wildcard domain, preview-only
environment variables and optional PR labels. Save with previews enabled.
Preview environment variables are separate from production variables.

Verify with real pull requests:

1. Deploy production and put a sentinel value in its named volume.
2. Open a PR. Verify a new preview record, deployment logs, GitHub comment and HTTP
   response. Inspect containers, volumes, image tags and networks inside `engine`.
3. Open another PR. Verify distinct URLs and resources; production's sentinel must
   remain unchanged. Preview containers must not publish production host ports.
4. Push a change to the first PR. Verify its existing preview and URL are reused.
   Repeat at the preview limit: existing previews must still update.
5. Rebuild from the UI. Verify cached code is rebuilt without cloning again.
6. Exercise label filtering and collaborator authorization. Unauthorized PRs must
   not create previews when the permission requirement is enabled.
7. Close/merge a PR, including while a build is running. Verify its containers,
   volumes, network, code, logs and database records disappear, while the other PR
   and production continue working.
8. Check preview listing, rebuild, domain editing and deletion using a restricted
   account. Each operation must inherit access from the parent Compose service.

Preview Compose files use project-scoped named volumes, build image tags and
networks. External volumes/configs/secrets, host networking, and bind mounts
outside the preview checkout are rejected; errors appear in deployment logs.
Compose `include`/`extends`, custom volume drivers/driver options and config/secret
files outside the project are also rejected. Deletion uses resource labels and
does not parse repository YAML. A database deletion marker prevents a concurrent
build from leaving running resources behind after PR closure.
`label_file`, outside-project `env_file` paths and external-container
`volumes_from` are rejected. Volume inheritance within the same preview and
project-local environment files remain supported.
File containment is enforced with `realpath` on the deployment host, including
symlink targets, the generated `.env`, build paths and preview patch destinations.
The host needs GNU-compatible `realpath -e`/`realpath -m`. Interpolated label keys
and interpolated local file paths are rejected; Traefik label keys are removed
case-insensitively.

Run Linux regression tests against this installation:

```sh
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml exec app pnpm test --run __test__/compose __test__/deploy/github-webhook-handler.test.ts __test__/git-provider/github-clone-host.test.ts __test__/queues/in-memory-queue.test.ts
```

Remove only this test installation and its disposable data:

```sh
docker compose -f apps/dokploy/scripts/compose-preview-test/compose.yml down --volumes
```

See [VALIDATION.md](VALIDATION.md) for the verification results.
