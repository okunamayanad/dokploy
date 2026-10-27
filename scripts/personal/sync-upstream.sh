#!/usr/bin/env bash
set -euo pipefail

UPSTREAM=$(gh release view --repo Dokploy/dokploy --json tagName --jq .tagName)
[[ "$UPSTREAM" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Unsupported upstream release'; exit 1; }
CURRENT=$(node -p "require('./packages/server/src/personal-release.json').upstreamVersion")
[ "$UPSTREAM" != "$CURRENT" ] || exit 0
REPOSITORY=${GITHUB_REPOSITORY:-okunamayanad/dokploy}
BRANCH="sync/upstream-$UPSTREAM"
if [ -n "$(gh pr list --repo "$REPOSITORY" --base personal --head "$BRANCH" --state all --json number --jq '.[0].number // empty')" ]; then
  echo 'Integration PR already exists; leaving its changes untouched.'
  exit 0
fi
git config user.name 'Personal Dokploy Bot'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git fetch https://github.com/Dokploy/dokploy.git "refs/tags/$UPSTREAM:refs/tags/$UPSTREAM"
git switch -c "$BRANCH"
CONFLICT=false
if git merge --no-edit "$UPSTREAM"; then
  node scripts/personal/version.mjs upstream "$UPSTREAM"
  git add packages/server/src/personal-release.json
  git commit -m "chore(personal): prepare $UPSTREAM.0"
else
  git merge --abort
  # GitHub can display the actual merge conflicts when the source is the upstream tag.
  git reset --hard "$UPSTREAM"
  CONFLICT=true
fi
git push origin "$BRANCH"
BODY=$(mktemp)
if [ "$CONFLICT" = true ]; then
  printf 'Integrate upstream %s into personal. Merge conflicts require resolution. After resolving, run `node scripts/personal/version.mjs upstream %s` and the Personal release verification workflow before merging.\n' "$UPSTREAM" "$UPSTREAM" > "$BODY"
else
  printf 'Integrate upstream %s into personal and prepare %s.0. Review the verification run before merging. Merging publishes the fork release after tests, multi-platform builds and image smoke checks pass; servers are not automatically upgraded.\n' "$UPSTREAM" "$UPSTREAM" > "$BODY"
fi
gh pr create --repo "$REPOSITORY" --base personal --head "$BRANCH" --title "chore(personal): integrate $UPSTREAM" --body-file "$BODY"
if [ "$CONFLICT" = false ]; then
  # GITHUB_TOKEN-created pushes/PRs do not trigger workflows automatically.
  gh workflow run personal-release.yml --repo "$REPOSITORY" --ref "$BRANCH"
fi
