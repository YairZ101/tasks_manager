# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Software developers coordinating software-related tasks.

## Product Purpose

Flow is a local-first task manager for creating tasks, defining versioned execution flows, and running those flows through coding agents and checks.

## Positioning

It runs entirely on the developer's machine and uses coding agents the developer has already configured, rather than requiring a hosted agent service or a separate provider setup.

## Operating Context

Developers work from a local software repository. They place tasks in an operational queue, design reusable flows, start runs, review agent and check output, resolve decisions, and keep task-scoped workspaces for unfinished or changed work.

## Capabilities and Constraints

- Tasks move through backlog, ready, active, needs-attention, and finished operational views.
- Flows are versioned and built from Begin, Agent, Check, Decision, Result, and Note blocks.
- Runs execute locally with existing CLI coding agents and commands.
- Workspaces are scoped to a task and reused across attempts and runs.
- Other product differentiators have not yet been captured.

## Evidence on Hand

The repository contains the working application and its source code under `packages/`. No external customer evidence, testimonials, benchmarks, or brand assets have been confirmed.

## Product Principles

- Keep orchestration and execution local to the developer's machine.
- Work with the coding agents and tools developers already use.
- Make task state, flow progress, decisions, and results explicit.
- Preserve unfinished or changed workspace state so developers can act on it.
