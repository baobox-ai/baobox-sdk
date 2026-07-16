# Contributing

## Commit conventions (public repository)

This is a **public** repository. To keep it clean and privacy-respecting:

- **Author email — use GitHub noreply.** Configure your commit author email to your
  GitHub-provided noreply address so a personal email is never published:

  ```sh
  git config user.email "<your-github-id>@users.noreply.github.com"
  ```

  (Find yours at GitHub → Settings → Emails → "Keep my email addresses private".)

- **AI-assisted commits** carry a noreply co-author trailer, e.g.
  `Co-Authored-By: <Assistant> <noreply@…>`.

- **No infrastructure or customer details.** Never include hostnames, account IDs,
  tenant slugs, customer names, secrets, or deployment identifiers in commit
  messages, code, issues, or PRs in this public repo. Infra-tinged work belongs in
  the private backend repository.

These conventions apply going forward; existing history is not rewritten.