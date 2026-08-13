---
name: git-pr
description: Manage Git delivery: create branches, make well-scoped commits, push, and open PRs when requested. Supports stacked PRs. Use this skill whenever the user mentions PRs, pull requests, committing, pushing, or branching — including "open PRs", "let's open PRs", "create a PR", "open a pull request", "submit PRs", "push changes", "commit and push", "split into PRs", "multiple PRs", or any variation that implies git branch/commit/push/PR operations as the outcome.
---

# Git PR

Carry out the Git outcome the user requested. Work autonomously: determine a sensible commit structure internally and do not present or request approval for a commit plan unless the user explicitly asks to review one. Follow these steps:

1. Run `git status` to see what has changed — review ALL modified, staged, and untracked files. Every change must be included in the requested delivery or explicitly justified as excluded.
2. Run the project's prescribed checks for what changed. If a named check is unavailable, use the closest documented project check instead and report that substitution. If only docs/config changed, targeted checks can be skipped.
3. Determine the requested external outcome. "Push" means push only; create a pull request only when the user explicitly asks for one. Do not infer a PR from a push request.
4. Create a commit map before staging. Use one row per independently reviewable product or engineering outcome:

   | Outcome | Files | Tests | Commit message |
   |---|---|---|---|

   - Make one commit per row. Do not use backend/frontend boundaries as commit boundaries when they contain several independent changes.
   - Keep tests with the behavior they cover. Documentation belongs with the change it documents unless it is independently useful.
   - A single commit is allowed only when the map has exactly one row and a reviewer can describe its purpose precisely in one sentence.
   - Treat the diff as large when any condition is true: it changes more than 10 files, changes more than 500 total lines, or spans three or more product areas.
   - For a large diff, share the commit map in commentary before staging. This is a required exception to the usual rule against presenting the commit plan. Proceed after sharing it; do not stop for approval unless the user explicitly requested a single commit that conflicts with the map.
   - If the user explicitly requests one commit for a multi-row map, explain the review cost and ask whether to keep one commit or use the mapped split. Never silently collapse multiple rows into one commit.
5. For each branch or PR-sized delivery:
   a. Determine the base:
      - If this PR is independent → branch from `main`
      - If this PR depends on a previous PR → branch from that PR's branch (stacked PR)
   b. Create the branch using a conventional, work-descriptive prefix such as `feature/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, or `ci/`. Branch names must describe the product or engineering change only. Do not include the name of any AI agent, model, tool, assistant, automation, or vendor in branch names.
   c. Stage and commit one internal-map outcome at a time. Use conventional commit prefixes (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`).
   d. Apply the commit granularity gate before every commit:
      - Run `git diff --cached --stat` and `git diff --cached --name-status`, then compare the staged files with the current map row.
      - Do not commit staged files that belong to another map row. Unstage them and commit the current row first.
      - Inspect the staged diff and ask whether a reviewer can describe its purpose in one sentence. If not, split it.
      - A commit spanning multiple packages is acceptable when they jointly implement one outcome; package boundaries alone do not require a split.
      - A commit containing several independently useful features, fixes, refactors, or workflows must be split.
      - Confirm that the relevant tests are included with their behavior change.
      - Each commit message must use one of the allowed conventional prefixes exactly (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`), for example `refactor: add market-data operation errors` or `docs: clarify PR branch naming`.
      - Commit messages must describe the work itself only. Do not include the name of any AI agent, model, tool, assistant, automation, or vendor in commit messages or trailers.
   e. After every commit, run `git show --stat --oneline HEAD` and `git status --short`. Compare the committed files with the map row and fix an incorrectly scoped commit before pushing. Also check for omitted, orphaned, or accidentally staged files before continuing.
   f. If the user requested a push or a PR, push the branch: `git push -u origin <branch-name>`.
   g. If the user requested a PR, create it: `unset GITHUB_TOKEN && gh pr create --base <base-branch> --title "<title>" --body "<description>"`
      - Fill in the PR body following the template in `.github/pull_request_template.md`
      - For stacked PRs, set `--base` to the parent PR's branch, and note the dependency in the Dependencies section
      - PR titles and bodies must describe the product or engineering change only. Do not include the name of any AI agent, model, tool, assistant, automation, or vendor.
   h. Switch to the appropriate base before starting the next delivery.
6. Report the ordered commit list and any pushed branch or PR links after the requested work succeeds.

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
- Do not show a commit plan or request approval before committing unless the user asked for that level of review
- Exception: large diffs must show the commit map before staging, as defined above
- Match the requested scope exactly: a push-only request must not create a PR
- Clearly document dependencies between stacked PRs in the PR body
- **Keep PR descriptions current** — when amending, force-pushing, or otherwise changing a PR after opening it, update the PR title and body to reflect the final state of the changes. Use `gh pr edit <number> --title "..." --body "..."`. The description must always match what the reviewer will see in the diff.
- **No AI identity in git metadata** — do not mention any AI agent, model, tool, assistant, automation, or vendor in branch names, commit messages, commit trailers, PR titles, or PR bodies. Commits are authored by the user.
