# Remove the Ready Task State

## Decision

Flow has one pre-run state: **Backlog**. Starting a Run moves a task to Active. Paused and stopped Runs return an open task to Backlog.

## Why

Ready duplicated the purpose of Backlog without adding a distinct action or meaningful restriction. A single pre-run queue makes the work board and task lifecycle easier to understand.

## Data model

This is a greenfield schema change. `queue_state` is removed from new databases. Per the project database-compatibility policy, do not add migrations or preservation work for existing local Flow databases; reinitialize them instead.
