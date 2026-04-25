# Commit Messages

All commit messages in this repository MUST conform to the Conventional Commits
specification, enforced locally by commitlint
(https://github.com/conventional-changelog/commitlint) via the Husky `commit-msg`
hook configured in `.husky/commit-msg` and `commitlint.config.js`
(`@commitlint/config-conventional`).

When generating a commit message, always produce it in this form:

```
<type>(<optional-scope>): <subject>

<optional body>

<optional footer>
```

Rules to follow:
- `type` must be one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `build`, `ci`, `chore`, `revert`.
- `type` and `subject` are lowercase; `subject` is in the imperative mood and
  does not end with a period.
- Header (the first line) must be 100 characters or fewer.
- Body and footer lines are separated from the header by a blank line.
- Use the `BREAKING CHANGE:` footer (or `!` after the type/scope) for
  backwards-incompatible changes.

Before finalizing any commit, mentally verify the message would pass
`npx commitlint --edit <msg-file>`. If a hook rejects the commit, fix the
message and create a new commit — do not bypass the hook with `--no-verify`.
