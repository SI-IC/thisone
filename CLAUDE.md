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
