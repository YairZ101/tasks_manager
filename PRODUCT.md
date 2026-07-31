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

Flow is intended for laptop and desktop use. Mobile layouts are outside the supported product scope, but core workflows must remain usable and coherent across compact and wide desktop windows, including the narrower viewport available in the Codex in-app browser.

## Capabilities and Constraints

- Tasks move through backlog, ready, active, needs-attention, and finished operational views.
- Flows are versioned and built from Begin, Agent, Check, Decision, Result, and Note blocks.
- The Flow editor is a primary product surface. It is optimized for laptop and desktop windows from 520 CSS pixels upward, must not disable editing based solely on width, and should degrade gracefully in smaller windows without claiming mobile support.
- The Flow canvas uses semantic zoom: overview from 20–34% shows a distinct, readable icon for each block type, compact from 35–54% shows counter-scaled block names and types, and detail from 55–160% reveals configuration and outcome labels. Block geometry and connection anchors remain fixed when the presentation mode changes.
- The canvas zoom controls display the current zoom percentage and update it after zooming or fitting the Flow.
- Clicking a Flow block opens its settings. Dragging only repositions the block and must not open settings as a side effect.
- All application pictograms and block graphics come from the shared icon registry. A block type uses the same symbol in onboarding, the Flow library, the editor, and the inspector; Decision uses a plain question mark.
- The application shell and focused Flow editor must occupy the full browser viewport at every supported width. Page-level overflow must not create unused space or shrink the app; each surface owns its internal scrolling.
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
