# Shared App Icon System

Date: 2026-07-31

## Context

Block graphics had separate implementations in the Flow editor, Flow library, and onboarding preview. Updating one surface could leave the others with old letter or shape glyphs.

## Decision

- `Icon.tsx` owns every application pictogram and the block-type-to-icon registry.
- Product surfaces render block symbols through `BlockIcon`; they do not derive letters or shapes locally.
- Decision uses a plain question-mark icon.
- Decorative connectors, status dots, user-entered initials, and keyboard shortcut characters are content or layout primitives rather than icons.

## Verification

Component tests assert that the editor, Flow library, and onboarding preview resolve Decision through the shared question-mark icon. A source audit rejects raw SVG elements outside the shared icon component and checks for legacy block glyph derivation.
