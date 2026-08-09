# One Works Brand Studio

One Works Brand Studio is the canonical source for maintained brand scenes and
their exported assets. The preview and PNG export pipeline render the same DOM;
there is no separate simplified distribution template.

## Commands

```bash
pnpm dev
pnpm render
pnpm check
```

- `pnpm dev` serves the complete studio and exact export views.
- `pnpm render` captures every configured scene and theme from `index.html`.
- `pnpm check` validates the scene registry, generated files, dimensions, and
  manifest hashes.

## Source of truth

`index.html` is both the editable preview and the renderer. Export URLs use the
form `/?scene=github-org-readme&theme=dark&export=1`; export mode isolates the
selected `.brand-mockup` without recreating any grid, orbit, star, icon, comet,
or distorted text layer.

Scene names and target sizes are declared in `studio.config.json`. Generated
files and their source hash are recorded in `dist/manifest.json`.

The repository is intended to be mounted in the One Works application
repository at `assets/brand-studio` as a Git submodule. It must remain outside
the application pnpm workspace.
