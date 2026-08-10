import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  productRoot,
  readDistribution,
  resolveContained,
  root,
  sha256
} from './catalog.mjs'

export const syncDistributionAssets = ({ checkOnly = false } = {}) => {
  const distribution = readDistribution()
  const results = []

  for (const surface of distribution.surfaces) {
    for (const deployment of surface.deployments ?? []) {
      const sourceRelative = `dist/${surface.studioScene}-${deployment.theme}.png`
      const source = resolveContained(root, sourceRelative, `distribution source for ${surface.id}`)
      const target = resolveContained(productRoot, deployment.target, `distribution target for ${surface.id}`)

      if (!existsSync(source)) {
        throw new Error(`Missing rendered distribution source: ${sourceRelative}`)
      }

      const sourceBytes = readFileSync(source)
      const targetBytes = existsSync(target) ? readFileSync(target) : undefined
      const current = targetBytes?.equals(sourceBytes) === true

      if (!current && !checkOnly) {
        mkdirSync(dirname(target), { recursive: true })
        cpSync(source, target)
      }

      results.push({
        current,
        sha256: sha256(sourceBytes),
        source: sourceRelative,
        surface: surface.id,
        target: deployment.target,
        theme: deployment.theme
      })
    }
  }

  const stale = results.filter(result => !result.current)
  if (checkOnly && stale.length > 0) {
    for (const result of stale) {
      process.stderr.write(`Stale distribution target: ${result.target} <- ${result.source}\n`)
    }
    throw new Error(`${stale.length} distribution target${stale.length === 1 ? '' : 's'} need synchronization`)
  }

  const action = checkOnly ? 'Verified' : 'Synchronized'
  process.stdout.write(`${action} ${results.length} distribution target${results.length === 1 ? '' : 's'} from exact Studio exports.\n`)
  return results
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  syncDistributionAssets({ checkOnly: process.argv.includes('--check') })
}
