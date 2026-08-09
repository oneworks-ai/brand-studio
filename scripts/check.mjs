import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = JSON.parse(readFileSync(resolve(root, 'studio.config.json'), 'utf8'))
const manifestPath = resolve(root, 'dist/manifest.json')

if (!existsSync(manifestPath)) throw new Error('Run pnpm render before pnpm check')

const source = readFileSync(resolve(root, 'index.html'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sourceSha256 = createHash('sha256').update(source).digest('hex')

if (manifest.sourceSha256 !== sourceSha256) {
  throw new Error('Generated assets are stale: index.html changed after the last render')
}

const expected = config.scenes.flatMap(scene => scene.themes.map(theme => ({ scene, theme })))
if (manifest.artifacts.length !== expected.length) {
  throw new Error(`Expected ${expected.length} artifacts, found ${manifest.artifacts.length}`)
}

for (const { scene, theme } of expected) {
  const artifact = manifest.artifacts.find(item => item.scene === scene.name && item.theme === theme)
  if (!artifact) throw new Error(`Missing artifact for ${scene.name}/${theme}`)
  if (artifact.width !== scene.width || artifact.height !== scene.height) {
    throw new Error(`Dimension metadata drift for ${artifact.file}`)
  }
  const path = resolve(root, artifact.file)
  if (!existsSync(path)) throw new Error(`Missing ${artifact.file}`)
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (digest !== artifact.sha256) throw new Error(`Hash mismatch for ${artifact.file}`)
}

if (source.includes('distribution-source.html')) {
  throw new Error('Legacy simplified renderer must not be referenced by the Studio source')
}

process.stdout.write(`Verified ${manifest.artifacts.length} exact scene exports from one source.\n`)
