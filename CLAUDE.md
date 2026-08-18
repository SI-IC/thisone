# Release on push

Never push to `main` without a release: a version bump (`package.json`), a rebuilt `dist/`, and a
`v<version>` tag.

- `src/` changed, no explicit bump yet → husky `pre-commit` auto-bumps patch, rebuilds `dist/`,
  stages both; `post-commit` tags `v<version>`. This covers plain bug fixes.
- New feature / behavior change → bump manually before committing: `pnpm release minor` (or
  `major`) so the version reflects the change, not just a patch. The pre-commit hook skips its
  own auto-bump once `package.json`'s working version already differs from `HEAD`'s.
- The `post-commit` tag is lightweight (`git tag "$tag"`, no `-a`) — `--follow-tags` only pushes
  annotated tags and silently skips it. Push it explicitly: `git push origin v<version>` (or
  `git push --tags`). A commit without its tag pushed is not a release.
- Pushing the tag publishes both packages: `.github/workflows/publish.yml` builds and tests in a
  job without `id-token`, then publishes from a second job (root first, then the legacy alias) via
  npm trusted publishing — OIDC, no token in the repo. Both package names need their own trusted
  publisher on npmjs.com pointing at `publish.yml`. Re-running a tag is safe: already-published
  versions are skipped. `scripts/publish.mjs` refuses to publish from anything but a `v<version>`
  tag inside Actions, so a manual re-run must select the tag as its ref. Publishing by hand is the
  fallback only; `node scripts/publish.mjs --dry-run` shows what would go out.
