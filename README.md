# One Works Brand Studio

One Works Brand Studio is the canonical source for maintained brand scenes and
their exported assets. The preview and PNG export pipeline render the same DOM;
there is no separate simplified distribution template.

[Open the published Brand Studio](https://oneworks-ai.github.io/brand-studio/)

## Commands

```bash
pnpm dev
pnpm render
pnpm sync:distribution
pnpm check
```

- `pnpm dev` serves the complete studio and exact export views.
- The studio console switches between configured scenes and themes, keeps the
  fixed export ratio visible, and downloads the matching validated PNG.
- `/?view=distribution` is the data-driven publishing console for every
  maintained placement. Scene-backed rows preview the latest validated `dist`
  exports and separately list their real deployment targets, operational links,
  update method, automation boundary, and known platform pitfalls.
- Checksums and exact export links stay in the Studio's collapsed advanced
  section so the default image workflow remains task-focused.
- `pnpm render` captures every configured scene and theme from `index.html`.
- `pnpm sync:distribution` copies the exact validated exports to canonical app
  distribution mirrors and every declared repository destination. Theme-to-
  target mappings live beside each publishing surface in
  `distribution/distribution.json`; platform-only uploads remain explicit
  manual steps.
- `pnpm check` validates the scene registry, generated files, dimensions, and
  manifest hashes, and fails if any declared repository destination is stale.

The render workflow checks the latest `oneworks-ai/app` catalog every six
hours, and also accepts the `product-catalog-updated` repository dispatch for
immediate refreshes. Adapter, model-service, channel, icon, and distribution
preview changes are synchronized before every render; changed exports are
opened as an automation pull request instead of being pushed directly to
`main`.

## Source of truth

`index.html` is both the editable preview and the renderer. Export URLs use the
form `/?scene=github-org-readme&theme=dark&export=1`; export mode isolates the
selected `.brand-mockup` without recreating any grid, orbit, star, icon, comet,
or distorted text layer.

Scene names and target sizes are declared in `studio.config.json`. Generated
files and their source hash are recorded in `dist/manifest.json`.

The current registry contains 7 scenes and 14 exact light/dark PNG exports.
For scene-backed publishing rows, `dist/<scene>-<theme>.png` is the latest
candidate asset; `distribution/distribution.json` keeps the destination paths
that must be synchronized or uploaded. Do not use an older deployed copy as
the Studio preview.

Publishing knowledge is declared in `distribution/distribution.json`. Keep
stable platform instructions there instead of adding temporary rollout notes
to the Studio UI. The compiler validates links, scene references, statuses,
and required maintenance fields before rendering the management view.

The repository is intended to be mounted in the One Works application
repository at `assets/brand-studio` as a Git submodule. It must remain outside
the application pnpm workspace.
