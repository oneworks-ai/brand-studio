import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { productRoot, readDistribution, resolveContained, root, sha256 } from './catalog.mjs'

export const isDistributionTargetExcluded = (target, prefixes) => (
  prefixes.some(prefix => target.startsWith(prefix))
)

export const syncDistributionAssets = ({ checkOnly = false } = {}) => {
  const distribution = readDistribution()
  const results = []
  const excludedPrefixes = (process.env.ONEWORKS_DISTRIBUTION_EXCLUDE_PREFIXES ?? '')
    .split(',')
    .map(prefix => prefix.trim())
    .filter(Boolean)

  for (const surface of distribution.surfaces) {
    for (const deployment of surface.deployments ?? []) {
      const sourceRelative = `dist/${surface.studioScene}-${deployment.theme}.png`
      const source = resolveContained(root, sourceRelative, `distribution source for ${surface.id}`)
      const target = resolveContained(productRoot, deployment.target, `distribution target for ${surface.id}`)
      const excluded = isDistributionTargetExcluded(deployment.target, excludedPrefixes)

      if (!existsSync(source)) {
        throw new Error(`Missing rendered distribution source: ${sourceRelative}`)
      }

      const sourceBytes = readFileSync(source)
      const targetBytes = existsSync(target) ? readFileSync(target) : undefined
      const current = targetBytes?.equals(sourceBytes) === true

      if (!current && !checkOnly && !excluded) {
        mkdirSync(dirname(target), { recursive: true })
        cpSync(source, target)
      }

      results.push({
        current,
        excluded,
        sha256: sha256(sourceBytes),
        source: sourceRelative,
        surface: surface.id,
        target: deployment.target,
        theme: deployment.theme
      })
    }
  }

  const stale = results.filter(result => !result.current && !result.excluded)
  if (checkOnly && stale.length > 0) {
    for (const result of stale) {
      process.stderr.write(`Stale distribution target: ${result.target} <- ${result.source}\n`)
    }
    throw new Error(`${stale.length} distribution target${stale.length === 1 ? '' : 's'} need synchronization`)
  }

  const action = checkOnly ? 'Verified' : 'Synchronized'
  process.stdout.write(
    `${action} ${results.length} distribution target${results.length === 1 ? '' : 's'} from exact Studio exports.\n`
  )
  return results
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  syncDistributionAssets({ checkOnly: process.argv.includes('--check') })
}
