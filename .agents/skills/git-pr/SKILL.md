---
name: git-pr
description: Create branch(es), commit all changes, push, and open PR(s). Supports stacked PRs. Use this skill whenever the user mentions PRs, pull requests, committing, pushing, or branching — including "open PRs", "let's open PRs", "create a PR", "open a pull request", "submit PRs", "push changes", "commit and push", "split into PRs", "multiple PRs", or any variation that implies git branch/commit/push/PR operations as the outcome.
---

# Git PR

Create branch(es), commit all changes, push, and open PR(s). Follow these steps exactly:

1. Run `git status` to see what has changed — review ALL modified, staged, and untracked files. Every change must be accounted for: either included in a PR or explicitly justified as excluded.
2. Run checks based on what changed. If backend files were changed, run `make be-check`, `make be-test-api-integration`, and `make be-test-provider-integration`. If frontend files were changed, run `make fe-check`. If both changed, run both. If only docs/config changed, checks can be skipped.
3. Assess the scope of changes:
   - If changes are small/focused → single PR
   - If changes span multiple concerns (e.g., new feature + CI + docs) → split into multiple PRs, each covering one logical unit
4. For each PR:
   a. Determine the base:
      - If this PR is independent → branch from `main`
      - If this PR depends on a previous PR → branch from that PR's branch (stacked PR)
   b. Create the branch using a conventional, work-descriptive prefix such as `feature/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, or `ci/`. Branch names must describe the product or engineering change only. Do not include the name of any AI agent, model, tool, assistant, automation, or vendor in branch names.
   c. **Plan commits before creating them.** List the distinct logical units in the changeset (e.g., new shared package, refactor, feature A, feature B, docs, tests). Each unit becomes its own commit. A single catch-all commit is never acceptable when changes span multiple concerns — even if they all serve one feature. Use conventional commit prefixes (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`).
      - Example: a feature that adds a validation package, refactors a CLI command, adds a new service method, and updates docs → 4 commits, not 1.
   d. Validate the commit plan before committing:
      - If the PR changes multiple layers, packages, workflows, or docs plus code, it needs multiple commits.
      - If a proposed single commit touches multiple concerns, stop and split it before committing.
      - Each commit message must use one of the allowed conventional prefixes exactly (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`), for example `refactor: add market-data operation errors` or `docs: clarify PR branch naming`.
      - Commit messages must describe the work itself only. Do not include the name of any AI agent, model, tool, assistant, automation, or vendor in commit messages or trailers.
   e. Push the branch: `git push -u origin <branch-name>`
   f. Create the PR: `unset GITHUB_TOKEN && gh pr create --base <base-branch> --title "<title>" --body "<description>"`
      - Fill in the PR body following the template in `.github/pull_request_template.md`
      - For stacked PRs, set `--base` to the parent PR's branch, and note the dependency in the Dependencies section
      - PR titles and bodies must describe the product or engineering change only. Do not include the name of any AI agent, model, tool, assistant, automation, or vendor.
   g. Switch to the appropriate base before starting the next PR
5. Share all PR links at the end, noting any dependency chain

## Stacked PRs

When PR #1 is merged into main, rebase dependent PRs onto main:

```bash
git rebase --onto main <old-base> <branch>
```

Then update the PR base to main:

```bash
unset GITHUB_TOKEN && gh pr edit <number> --base main
```

Force push the rebased branch:

```bash
git push --force-with-lease
```

## Staging guard for split commits

When unstaging all changes (`git reset`) to build commits incrementally, git splits renames into separate "add new path" and "delete old path" entries. After each `git commit`, run `git status` and check for orphaned deletions or untracked files that belong to the same logical change. Stage them into the same commit (`git commit --amend --no-edit`) before moving on.

## Rules

- Never commit to `main` directly
- Each commit should be independently meaningful
- Each PR should be independently reviewable and not break existing functionality
- Clearly document dependencies between stacked PRs in the PR body
- **Keep PR descriptions current** — when amending, force-pushing, or otherwise changing a PR after opening it, update the PR title and body to reflect the final state of the changes. Use `gh pr edit <number> --title "..." --body "..."`. The description must always match what the reviewer will see in the diff.
- **No AI identity in git metadata** — do not mention any AI agent, model, tool, assistant, automation, or vendor in branch names, commit messages, commit trailers, PR titles, or PR bodies. Commits are authored by the user.
