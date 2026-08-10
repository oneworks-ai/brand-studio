# Brand Studio Agent Guide

This repository owns the editable One Works brand scenes, exact previews, PNG
exports, visual baselines, export manifest, and the stable distribution catalog.

## Hard boundary

- `index.html` is the single rendering source for both preview and export.
- Never add a second HTML/card implementation for generated assets.
- Export mode may isolate and resize a scene, but it must move the existing DOM
  node rather than reconstruct it.
- Moonshot provider and Kimi adapter are distinct identities and assets.
- A visual change is not accepted until the user reviews the exact export view.
- Scene selection cards use the current theme's exact generated PNG as their
  preview. Never replace them with text-only cards or approximate thumbnails.
- Scene-backed distribution rows preview the latest validated `dist` export
  and list deployed repository or platform paths separately as destinations.
  Non-scene rows show synchronized current repository assets. All previews
  use containment rather than cropping so the asset itself stays honest.
- Catalog-driven scenes consume adapter, model-service, and channel entries
  from the application repository's `assets/brand/catalog.json`. Keep
  scheduled and repository-dispatch synchronization working when changing the
  render pipeline; app-owned additions and removals must converge without
  deleting non-app extensions.
- `distribution/distribution.json` owns stable publishing destinations, links,
  update instructions, automation boundaries, and pitfalls. Temporary rollout
  progress never belongs in the Studio UI or this catalog.
- Scene exports reach repository consumers only through the declarative
  `deployments` mapping and `pnpm sync:distribution`. Never manually copy an
  export without recording its theme-to-target mapping, and keep platform-only
  uploads out of that mapping.

## Workflow

1. Run `pnpm dev` and review the normal studio page.
2. Verify the console scene/theme controls, fixed-ratio preview, and current
   PNG download all resolve to the same configured scene.
3. Review `/?view=distribution`; verify search, platform filters, links, and
   disclosures are generated from the distribution catalog.
4. Review each affected exact export URL from `studio.config.json`.
5. Run `pnpm render` only after the scene is approved.
6. Run `pnpm sync:distribution` to update declared repository consumers.
7. Run `pnpm check` before delivery; it rejects stale consumers.

Generated assets are consumers of `index.html`, never design sources.

The organization does not allow GitHub Actions to create pull requests.
Automation may update `automation/render-brand-assets` and report the branch,
but a maintainer or authorized Git operator owns PR creation and merging.
