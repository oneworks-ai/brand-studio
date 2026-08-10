import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const catalogPath = resolve(root, 'catalog/catalog.json')
export const distributionPath = resolve(root, 'distribution/distribution.json')
export const productRoot = resolve(process.env.ONEWORKS_APP_ROOT ?? resolve(root, '../..'))

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const kinds = new Set(['adapter', 'channel', 'model-service'])
const imageExtensions = new Set(['.ico', '.png', '.svg', '.webp'])
const sceneNamePattern = /^[a-z0-9-]+$/u
const themes = new Set(['dark', 'light'])
const distributionStatuses = new Set(['automated', 'hybrid', 'manual'])
const deploymentThemes = new Set(['dark', 'light'])
const externalUrlPattern = /^https:\/\/[a-z0-9.-]+(?:[/?#]|$)/u
const previewPathPattern = /^(?:apps|assets|dist|packages)\/[a-zA-Z0-9/_.-]+\.(?:ico|png|svg|webp)$/u

export const resolveContained = (base, path, label) => {
  if (typeof path !== 'string' || path.trim() === '' || path.includes('\0')) {
    throw new Error(`Invalid ${label}: ${String(path)}`)
  }
  const resolvedBase = resolve(base)
  const resolvedPath = resolve(resolvedBase, path)
  const relativePath = relative(resolvedBase, resolvedPath)
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside ${resolvedBase}: ${path}`)
  }
  return resolvedPath
}

export const readStudioConfig = () => {
  const config = readJson(resolve(root, 'studio.config.json'))
  if (!Array.isArray(config.scenes) || config.scenes.length === 0) {
    throw new Error('Invalid Brand Studio config: scenes must be a non-empty array.')
  }

  const names = new Set()
  const articles = new Set()
  for (const scene of config.scenes) {
    if (typeof scene.name !== 'string' || !sceneNamePattern.test(scene.name)) {
      throw new Error(`Invalid scene name: ${String(scene.name)}`)
    }
    if (names.has(scene.name)) throw new Error(`Duplicate scene name: ${scene.name}`)
    names.add(scene.name)
    if (typeof scene.label !== 'string' || scene.label.trim() === '') {
      throw new Error(`Missing scene label for ${scene.name}`)
    }
    if (!Number.isInteger(scene.article) || scene.article < 1 || articles.has(scene.article)) {
      throw new Error(`Invalid or duplicate article for ${scene.name}`)
    }
    articles.add(scene.article)
    for (const dimension of ['height', 'width']) {
      if (!Number.isInteger(scene[dimension]) || scene[dimension] < 1 || scene[dimension] > 8192) {
        throw new Error(`Invalid ${dimension} for ${scene.name}`)
      }
    }
    if (!Array.isArray(scene.themes) || scene.themes.length !== 2 ||
        new Set(scene.themes).size !== 2 || scene.themes.some(theme => !themes.has(theme))) {
      throw new Error(`Scene ${scene.name} must declare light and dark themes exactly once`)
    }
  }
  return config
}

export const readCatalog = () => {
  const catalog = readJson(catalogPath)
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
    throw new Error('Unsupported Brand Studio catalog schema; expected schemaVersion 1.')
  }

  const identities = new Set()
  for (const entry of catalog.entries) {
    if (typeof entry.id !== 'string' || entry.id === '' || !/^[a-z0-9-]+$/u.test(entry.id)) {
      throw new Error(`Invalid catalog id: ${String(entry.id)}`)
    }
    if (!kinds.has(entry.kind)) throw new Error(`Invalid catalog kind for ${entry.id}`)
    if (typeof entry.label !== 'string' || entry.label.trim() === '') {
      throw new Error(`Missing catalog label for ${entry.id}`)
    }
    if (!Number.isInteger(entry.priority) || entry.priority < 0) {
      throw new Error(`Invalid catalog priority for ${entry.id}`)
    }
    if (identities.has(`${entry.kind}:${entry.id}`)) {
      throw new Error(`Duplicate catalog identity: ${entry.kind}:${entry.id}`)
    }
    identities.add(`${entry.kind}:${entry.id}`)

    for (const icon of [entry.icon, entry.darkIcon].filter(Boolean)) {
      if (!/^assets\/icons\/[a-z0-9/_-]+\.(?:ico|png|svg|webp)$/u.test(icon)) {
        throw new Error(`Invalid catalog icon path for ${entry.id}: ${icon}`)
      }
      const path = resolveContained(resolve(root, 'assets/icons'), icon.slice('assets/icons/'.length), `catalog icon for ${entry.id}`)
      if (!imageExtensions.has(extname(path)) || !existsSync(path)) {
        throw new Error(`Missing catalog icon for ${entry.id}: ${icon}`)
      }
    }
    if (typeof entry.provenance?.repository !== 'string' || typeof entry.provenance?.path !== 'string') {
      throw new Error(`Missing catalog provenance for ${entry.id}`)
    }
  }
  return catalog
}

export const readDistribution = (config = readStudioConfig()) => {
  const distribution = readJson(distributionPath)
  if (distribution.schemaVersion !== 1 || !Array.isArray(distribution.surfaces) || distribution.surfaces.length === 0) {
    throw new Error('Unsupported Brand Studio distribution schema; expected schemaVersion 1.')
  }

  const sceneNames = new Set(config.scenes.map(scene => scene.name))
  const identities = new Set()
  for (const surface of distribution.surfaces) {
    if (typeof surface.id !== 'string' || !sceneNamePattern.test(surface.id) || identities.has(surface.id)) {
      throw new Error(`Invalid or duplicate distribution id: ${String(surface.id)}`)
    }
    identities.add(surface.id)
    for (const field of ['platform', 'surface', 'automation']) {
      if (typeof surface[field] !== 'string' || surface[field].trim() === '') {
        throw new Error(`Missing distribution ${field} for ${surface.id}`)
      }
    }
    if (!distributionStatuses.has(surface.status)) {
      throw new Error(`Invalid distribution status for ${surface.id}`)
    }
    const previewPaths = typeof surface.preview === 'string'
      ? [surface.preview]
      : [surface.preview?.light, surface.preview?.dark]
    if (previewPaths.some(path => typeof path !== 'string' || !previewPathPattern.test(path))) {
      throw new Error(`Invalid distribution preview for ${surface.id}`)
    }
    for (const previewPath of previewPaths) {
      const previewBase = previewPath.startsWith('dist/') ? root : productRoot
      const preview = resolveContained(previewBase, previewPath, `distribution preview for ${surface.id}`)
      const generatedPreview = previewPath === `dist/${surface.studioScene}-light.png` ||
        previewPath === `dist/${surface.studioScene}-dark.png`
      if ((!generatedPreview && !existsSync(preview)) || !imageExtensions.has(extname(preview))) {
        throw new Error(`Missing distribution preview for ${surface.id}: ${previewPath}`)
      }
    }
    if (surface.studioScene != null && !sceneNames.has(surface.studioScene)) {
      throw new Error(`Unknown Studio scene for ${surface.id}: ${surface.studioScene}`)
    }
    if (surface.studioScene != null) {
      const expectedPreviews = new Set([
        `dist/${surface.studioScene}-light.png`,
        `dist/${surface.studioScene}-dark.png`
      ])
      if (previewPaths.length !== expectedPreviews.size || previewPaths.some(path => !expectedPreviews.has(path))) {
        throw new Error(`Studio distribution preview must use the latest dist exports for ${surface.id}`)
      }
    }
    for (const field of ['artifacts', 'pitfalls', 'quickLinks', 'updateMethod']) {
      if (!Array.isArray(surface[field]) || surface[field].length === 0) {
        throw new Error(`Distribution ${field} must be non-empty for ${surface.id}`)
      }
    }
    for (const artifact of surface.artifacts) {
      if (typeof artifact !== 'string' || artifact.trim() === '' || artifact.includes('..') || artifact.startsWith('/')) {
        throw new Error(`Invalid distribution artifact for ${surface.id}: ${String(artifact)}`)
      }
    }
    if (surface.deployments != null) {
      if (surface.studioScene == null || !Array.isArray(surface.deployments) || surface.deployments.length === 0) {
        throw new Error(`Distribution deployments require a Studio scene for ${surface.id}`)
      }
      const deploymentTargets = new Set()
      const artifactTargets = new Set(surface.artifacts)
      for (const deployment of surface.deployments) {
        if (!deploymentThemes.has(deployment?.theme) ||
            typeof deployment?.target !== 'string' || deployment.target.trim() === '' ||
            deployment.target.includes('..') || deployment.target.startsWith('/') ||
            deploymentTargets.has(deployment.target)) {
          throw new Error(`Invalid distribution deployment for ${surface.id}`)
        }
        deploymentTargets.add(deployment.target)
      }
      for (const artifact of artifactTargets) {
        if (!deploymentTargets.has(artifact)) {
          throw new Error(`Repository artifact must have a distribution deployment for ${surface.id}: ${artifact}`)
        }
      }
    }
    for (const link of surface.quickLinks) {
      if (typeof link.label !== 'string' || link.label.trim() === '' ||
          typeof link.url !== 'string' || !externalUrlPattern.test(link.url)) {
        throw new Error(`Invalid distribution link for ${surface.id}`)
      }
    }
    for (const field of ['pitfalls', 'updateMethod']) {
      if (surface[field].some(value => typeof value !== 'string' || value.trim() === '')) {
        throw new Error(`Invalid distribution ${field} for ${surface.id}`)
      }
    }
  }
  return distribution
}

export const enabledEntries = (catalog, kind, { featuredOnly = true } = {}) => catalog.entries
  .filter(entry => entry.kind === kind && entry.enabled === true && (!featuredOnly || entry.featured === true))
  .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))

export const catalogInputs = catalog => {
  const paths = new Set([
    'catalog/catalog.json',
    'distribution/distribution.json',
    'src/studio.template.html',
    'studio.config.json'
  ])
  for (const entry of catalog.entries) {
    paths.add(entry.icon)
    if (entry.darkIcon) paths.add(entry.darkIcon)
  }
  for (const surface of readDistribution().surfaces) {
    const previews = typeof surface.preview === 'string'
      ? [['default', surface.preview]]
      : [['light', surface.preview.light], ['dark', surface.preview.dark]]
    for (const [theme, preview] of previews) {
      if (preview.startsWith('dist/')) continue
      const extension = preview.slice(preview.lastIndexOf('.'))
      paths.add(`assets/distribution/${surface.id}-${theme}${extension}`)
    }
  }
  return [...paths].sort().map(file => ({
    file,
    sha256: sha256(readFileSync(resolveContained(root, file, 'catalog input')))
  }))
}
