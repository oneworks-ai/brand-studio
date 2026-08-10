import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  catalogInputs,
  readCatalog,
  readDistribution,
  readStudioConfig,
  resolveContained
} from './catalog.mjs'
import { compileStudio } from './compile.mjs'
import { syncDistributionAssets } from './sync-distribution-assets.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = readStudioConfig()
const catalog = readCatalog()
const distribution = readDistribution(config)
const manifestPath = resolve(root, 'dist/manifest.json')

if (process.env.ONEWORKS_SKIP_DISTRIBUTION_SYNC_CHECK !== '1') {
  syncDistributionAssets({ checkOnly: true })
}

if (!existsSync(manifestPath)) throw new Error('Run pnpm render before pnpm check')

const source = readFileSync(resolve(root, 'index.html'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sourceSha256 = createHash('sha256').update(source).digest('hex')
const compiled = compileStudio({ write: false })

if (source.toString() !== compiled.html) {
  throw new Error('Generated source is stale: run pnpm compile')
}

if (manifest.sourceSha256 !== sourceSha256) {
  throw new Error('Generated assets are stale: index.html changed after the last render')
}

if (manifest.catalogEntries !== catalog.entries.length) {
  throw new Error('Generated assets are stale: catalog entry count changed')
}
if (JSON.stringify(manifest.inputs) !== JSON.stringify(catalogInputs(catalog))) {
  throw new Error('Generated assets are stale: catalog, template, config, or icon inputs changed')
}

const expected = config.scenes.flatMap(scene => scene.themes.map(theme => ({ scene, theme })))
const frozenArtifactHashes = {
  'dist/github-org-readme-dark.png': '2ab4d0c45180310394af432a12c145db531f27c89dbd7d7e6109473b26252255',
  'dist/github-org-readme-light.png': '1f7c436a2d4b8f8cad69a08af16e14d5dd3a1f7fd547c978949cb1bef5f9a30e'
}
if (manifest.artifacts.length !== expected.length) {
  throw new Error(`Expected ${expected.length} artifacts, found ${manifest.artifacts.length}`)
}

for (const { scene, theme } of expected) {
  const artifact = manifest.artifacts.find(item => item.scene === scene.name && item.theme === theme)
  if (!artifact) throw new Error(`Missing artifact for ${scene.name}/${theme}`)
  if (artifact.width !== scene.width || artifact.height !== scene.height) {
    throw new Error(`Dimension metadata drift for ${artifact.file}`)
  }
  const expectedFile = `dist/${scene.name}-${theme}.png`
  if (artifact.file !== expectedFile) throw new Error(`Unexpected artifact path: ${artifact.file}`)
  const path = resolveContained(resolve(root, 'dist'), `${scene.name}-${theme}.png`, 'artifact path')
  if (!existsSync(path)) throw new Error(`Missing ${artifact.file}`)
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (digest !== artifact.sha256) throw new Error(`Hash mismatch for ${artifact.file}`)
  if (frozenArtifactHashes[artifact.file] && digest !== frozenArtifactHashes[artifact.file]) {
    throw new Error(`Frozen approved asset changed: ${artifact.file}`)
  }
}

if (source.includes('distribution-source.html')) {
  throw new Error('Legacy simplified renderer must not be referenced by the Studio source')
}
if (!source.includes('data-brand-export-pending') || !source.includes('data-brand-scene-ready')) {
  throw new Error('Export views must stay hidden until the selected scene is ready')
}
if (!source.includes('data-studio-view="distribution"') || !source.includes('data-distribution-filter="all"')) {
  throw new Error('Distribution management view is missing from the generated Studio')
}
if (!source.includes('class="distribution-scroll"') || !source.includes('id="distribution-search"')) {
  throw new Error('Distribution resources must scroll independently beneath a fixed toolbar')
}
const scenePreviewCount = source.toString().match(/data-studio-select-scene="[a-z0-9-]+"/gu)?.length ?? 0
if (scenePreviewCount !== config.scenes.length) {
  throw new Error(`Expected ${config.scenes.length} authentic scene preview cards, found ${scenePreviewCount}`)
}
for (const surface of distribution.surfaces) {
  if (!source.includes(`data-distribution-id="${surface.id}"`) || !source.includes(`>${surface.surface}</h2>`)) {
    throw new Error(`Missing distribution surface in generated Studio: ${surface.id}`)
  }
  if (!source.includes(`${surface.surface} 当前资源预览`)) {
    throw new Error(`Missing authentic distribution preview for ${surface.id}`)
  }
}

const xScene = config.scenes.find(scene => scene.name === 'x-profile-header')
if (xScene?.width !== 1500 || xScene?.height !== 500 || !source.includes('runtime-network--x')) {
  throw new Error('X profile header must remain a native 1500 × 500 scene')
}
if (!source.includes('x-profile-header__avatar-preview') || !source.includes('platform-preview=1')) {
  throw new Error('X profile header must preview the real avatar overlap without baking it into exports')
}
if (source.includes('x-profile-header__org-source') || source.includes('object-view-box')) {
  throw new Error('X profile header must be drawn natively, never cropped or stretched from the Org PNG')
}

const orgScene = config.scenes.find(scene => scene.name === 'github-org-readme')
if (orgScene?.frozen !== true || source.includes('BRAND_STUDIO_NODES:org')) {
  throw new Error('Approved GitHub Org scene must stay frozen and independent from catalog generation')
}

const enabledFeatured = catalog.entries.filter(entry => entry.enabled === true && entry.featured === true)
for (const entry of enabledFeatured) {
  const occurrences = source.toString().match(new RegExp(`data-catalog-id="${entry.id}"`, 'gu'))?.length ?? 0
  if (occurrences !== 3) throw new Error(`Expected ${entry.id} in all three catalog-driven compositions`)
}

process.stdout.write(`Verified ${manifest.artifacts.length} exact scene exports from one source.\n`)
