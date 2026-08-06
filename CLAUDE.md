# Release on push

Never push to `main` without a release: a version bump (`package.json`), a rebuilt `dist/`, and a
`v<version>` tag.

- `src/` changed, no explicit bump yet → husky `pre-commit` auto-bumps patch, rebuilds `dist/`,
  stages both; `post-commit` tags `v<version>`. This covers plain bug fixes.
- New feature / behavior change → bump manually before committing: `pnpm release minor` (or
  `major`) so the version reflects the change, not just a patch. The pre-commit hook skips its
  own auto-bump once `package.json`'s working version already differs from `HEAD`'s.
- Before `git push`, always `git push --follow-tags` (or `git push && git push --tags`) — a commit
  without its tag pushed is not a release.
