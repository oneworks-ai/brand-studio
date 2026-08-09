# Brand Studio Agent Guide

This repository owns the editable One Works brand scenes, exact previews, PNG
exports, visual baselines, and export manifest.

## Hard boundary

- `index.html` is the single rendering source for both preview and export.
- Never add a second HTML/card implementation for generated assets.
- Export mode may isolate and resize a scene, but it must move the existing DOM
  node rather than reconstruct it.
- Moonshot provider and Kimi adapter are distinct identities and assets.
- A visual change is not accepted until the user reviews the exact export view.

## Workflow

1. Run `pnpm dev` and review the normal studio page.
2. Review each affected exact export URL from `studio.config.json`.
3. Run `pnpm render` only after the scene is approved.
4. Run `pnpm check` before delivery.

Generated assets are consumers of `index.html`, never design sources.
