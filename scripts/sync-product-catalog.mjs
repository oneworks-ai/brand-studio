import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'

import {
  catalogPath,
  productRoot,
  readCatalog,
  readDistribution,
  readProductCatalog,
  resolveContained,
  root
} from './catalog.mjs'

const expectedProductMarker = resolve(productRoot, 'assets/brand/catalog.json')

const iconDirectories = {
  adapter: 'adapters',
  channel: 'channels',
  'model-service': 'model-services'
}

const catalogIconPath = (entry, sourcePath, suffix = '') => (
  `assets/icons/${iconDirectories[entry.kind]}/${entry.outputId ?? entry.id}${suffix}${extname(sourcePath)}`
)

const entryIdentity = entry => `${entry.kind}:${entry.id}`
const entryIconPaths = entry => [entry.icon, entry.darkIcon].filter(Boolean)

export const mergeProductCatalog = (catalog, productCatalog) => {
  const externalEntries = catalog.entries.filter(entry => entry.provenance.repository !== 'oneworks-ai/app')
  const productEntries = productCatalog.entries.map(entry => {
    const { outputId: _outputId, ...catalogEntry } = entry
    return {
      ...catalogEntry,
      icon: catalogIconPath(entry, entry.icon),
      ...(entry.darkIcon == null ? {} : { darkIcon: catalogIconPath(entry, entry.darkIcon, '-dark') }),
      provenance: {
        repository: 'oneworks-ai/app',
        path: entry.icon,
        ...(entry.darkIcon == null ? {} : { darkPath: entry.darkIcon })
      }
    }
  })

  const externalIdentities = new Set(externalEntries.map(entryIdentity))
  const externalIconPaths = new Set(externalEntries.flatMap(entryIconPaths))
  const productIconOwners = new Map()
  for (const entry of productEntries) {
    const identity = entryIdentity(entry)
    if (externalIdentities.has(identity)) {
      throw new Error(`Product catalog identity conflicts with Studio extension: ${identity}`)
    }
    for (const iconPath of entryIconPaths(entry)) {
      const existingOwner = productIconOwners.get(iconPath)
      if (existingOwner != null) {
        throw new Error(`Product catalog output path conflicts: ${iconPath} (${existingOwner}, ${identity})`)
      }
      if (externalIconPaths.has(iconPath)) {
        throw new Error(`Product catalog output path conflicts with Studio extension: ${iconPath}`)
      }
      productIconOwners.set(iconPath, identity)
    }
  }

  return {
    schemaVersion: 1,
    entries: [...productEntries, ...externalEntries]
  }
}

export const syncProductAssets = () => {
  if (!existsSync(expectedProductMarker)) {
    throw new Error(`One Works app checkout not found at ${productRoot}`)
  }
  const catalog = readCatalog()
  const productCatalog = readProductCatalog()
  const nextCatalog = mergeProductCatalog(catalog, productCatalog)
  let changed = 0

  for (const entry of nextCatalog.entries) {
    if (entry.provenance.repository !== 'oneworks-ai/app') continue
    const iconPairs = [[entry.provenance.path, entry.icon]]
    if (entry.darkIcon && entry.provenance.darkPath) iconPairs.push([entry.provenance.darkPath, entry.darkIcon])
    for (const [sourcePath, destinationPath] of iconPairs) {
      const source = resolveContained(productRoot, sourcePath, `product source for ${entry.id}`)
      const destination = resolveContained(
        resolve(root, 'assets/icons'),
        destinationPath.slice('assets/icons/'.length),
        `catalog destination for ${entry.id}`
      )
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

  const nextIconPaths = new Set(nextCatalog.entries.flatMap(entryIconPaths))
  for (const entry of catalog.entries) {
    if (entry.provenance.repository !== 'oneworks-ai/app') continue
    for (const stalePath of entryIconPaths(entry).filter(path => !nextIconPaths.has(path))) {
      const staleIcon = resolveContained(root, stalePath, `stale catalog icon for ${entry.id}`)
      if (!existsSync(staleIcon)) continue
      rmSync(staleIcon)
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
      if (sourcePath.startsWith('dist/') || sourcePath.startsWith('assets/distribution/')) continue
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

  const nextCatalogText = `${JSON.stringify(nextCatalog, null, 2)}\n`
  if (readFileSync(catalogPath, 'utf8') !== nextCatalogText) {
    writeFileSync(catalogPath, nextCatalogText)
    changed += 1
  }
  return changed
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const changed = syncProductAssets()
  process.stdout.write(`Synchronized ${changed} product asset file${changed === 1 ? '' : 's'} from ${productRoot}.\n`)
}
