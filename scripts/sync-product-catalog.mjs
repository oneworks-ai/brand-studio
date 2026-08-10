import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  catalogPath,
  productRoot,
  readCatalog,
  readDistribution,
  resolveContained,
  root
} from './catalog.mjs'

const expectedProductMarker = resolve(productRoot, 'packages/adapters')

if (!existsSync(expectedProductMarker)) {
  throw new Error(`One Works app checkout not found at ${productRoot}`)
}

export const syncProductAssets = () => {
  const catalog = readCatalog()
  let changed = 0

  for (const entry of catalog.entries) {
    if (entry.provenance.repository !== 'oneworks-ai/app') continue
    const iconPairs = [[entry.provenance.path, entry.icon]]
    if (entry.darkIcon && entry.provenance.darkPath) iconPairs.push([entry.provenance.darkPath, entry.darkIcon])
    for (const [sourcePath, destinationPath] of iconPairs) {
      const source = resolveContained(productRoot, sourcePath, `product source for ${entry.id}`)
      const destination = resolveContained(resolve(root, 'assets/icons'), destinationPath.slice('assets/icons/'.length), `catalog destination for ${entry.id}`)
      if (!existsSync(source)) {
        if (entry.enabled === false) continue
        throw new Error(`Product catalog source is missing: ${sourcePath}`)
      }
      const sourceBytes = readFileSync(source)
      const destinationBytes = existsSync(destination) ? readFileSync(destination) : undefined
      if (destinationBytes?.equals(sourceBytes)) continue
      cpSync(source, destination)
      changed += 1
    }
  }

  const distribution = readDistribution()
  const previewDirectory = resolve(root, 'assets/distribution')
  for (const surface of distribution.surfaces) {
    const previews = typeof surface.preview === 'string'
      ? [['default', surface.preview]]
      : [['light', surface.preview.light], ['dark', surface.preview.dark]]
    for (const [theme, sourcePath] of previews) {
      if (sourcePath.startsWith('dist/')) continue
      const source = resolveContained(productRoot, sourcePath, `distribution preview for ${surface.id}`)
      const extension = sourcePath.slice(sourcePath.lastIndexOf('.'))
      const destination = resolveContained(
        previewDirectory,
        `${surface.id}-${theme}${extension}`,
        `distribution preview destination for ${surface.id}`
      )
      mkdirSync(dirname(destination), { recursive: true })
      const sourceBytes = readFileSync(source)
      const destinationBytes = existsSync(destination) ? readFileSync(destination) : undefined
      if (destinationBytes?.equals(sourceBytes)) continue
      cpSync(source, destination)
      changed += 1
    }
  }

  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
  return changed
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const changed = syncProductAssets()
  process.stdout.write(`Synchronized ${changed} product asset file${changed === 1 ? '' : 's'} from ${productRoot}.\n`)
}
