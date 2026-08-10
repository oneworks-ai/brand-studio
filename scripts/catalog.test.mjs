import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { enabledEntries, readCatalog, readDistribution, resolveContained } from './catalog.mjs'
import {
  compileStudio,
  gravityWarpPoint,
  orbitAngle,
  orbitPoint,
  xGravityWells,
  xOrbitCenter,
  xOrbitTiers
} from './compile.mjs'
import { isDistributionTargetExcluded } from './sync-distribution-assets.mjs'
import { mergeProductCatalog } from './sync-product-catalog.mjs'

test('resolveContained rejects traversal and absolute paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oneworks-brand-studio-test-'))
  assert.throws(() => resolveContained(directory, '../outside.png', 'test asset'), /must stay inside/u)
  assert.throws(() => resolveContained(directory, '/tmp/outside.png', 'test asset'), /must stay inside/u)
})

test('resolveContained allows a nested path inside its base', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oneworks-brand-studio-test-'))
  assert.equal(resolveContained(directory, 'nested/asset.png', 'test asset'), join(directory, 'nested/asset.png'))
})

test('read-only checks do not require a One Works app checkout', () => {
  const missingAppRoot = join(mkdtempSync(join(tmpdir(), 'oneworks-missing-app-')), 'app')
  const result = spawnSync(process.execPath, ['scripts/check.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ONEWORKS_APP_ROOT: missingAppRoot,
      ONEWORKS_SKIP_DISTRIBUTION_SYNC_CHECK: '1'
    }
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Verified 14 exact scene exports from one source\./u)
})

test('product catalog discovery adds and removes app-owned entries without replacing external entries', () => {
  const catalog = {
    schemaVersion: 1,
    entries: [
      {
        id: 'stale',
        kind: 'adapter',
        icon: 'assets/icons/adapters/stale.svg',
        provenance: { repository: 'oneworks-ai/app', path: 'assets/stale.svg' }
      },
      {
        id: 'external',
        kind: 'adapter',
        icon: 'assets/icons/adapters/external.svg',
        provenance: { repository: 'example/external', path: 'external.svg' }
      }
    ]
  }
  const productCatalog = {
    schemaVersion: 1,
    entries: [{
      id: 'pi',
      label: 'Pi',
      kind: 'adapter',
      icon: 'assets/brand/adapters/pi.svg',
      darkIcon: 'assets/brand/adapters/pi-dark.svg',
      enabled: true,
      featured: true,
      priority: 70
    }]
  }

  assert.deepEqual(mergeProductCatalog(catalog, productCatalog), {
    schemaVersion: 1,
    entries: [
      {
        id: 'pi',
        label: 'Pi',
        kind: 'adapter',
        icon: 'assets/icons/adapters/pi.svg',
        darkIcon: 'assets/icons/adapters/pi-dark.svg',
        enabled: true,
        featured: true,
        priority: 70,
        provenance: {
          repository: 'oneworks-ai/app',
          path: 'assets/brand/adapters/pi.svg',
          darkPath: 'assets/brand/adapters/pi-dark.svg'
        }
      },
      catalog.entries[1]
    ]
  })
})

test('product catalog discovery rejects extension and product output conflicts before synchronization', () => {
  const productEntry = {
    id: 'pi',
    label: 'Pi',
    kind: 'adapter',
    icon: 'assets/brand/adapters/pi.svg',
    enabled: true,
    featured: true,
    priority: 70
  }

  assert.throws(
    () =>
      mergeProductCatalog({
        schemaVersion: 1,
        entries: [{
          id: 'pi',
          kind: 'adapter',
          icon: 'assets/icons/adapters/external-pi.svg',
          provenance: { repository: 'example/external', path: 'external.svg' }
        }]
      }, { schemaVersion: 1, entries: [productEntry] }),
    /identity conflicts with Studio extension/u
  )

  assert.throws(
    () =>
      mergeProductCatalog({
        schemaVersion: 1,
        entries: [{
          id: 'external',
          kind: 'adapter',
          icon: 'assets/icons/adapters/pi.svg',
          provenance: { repository: 'example/external', path: 'external.svg' }
        }]
      }, { schemaVersion: 1, entries: [productEntry] }),
    /output path conflicts with Studio extension/u
  )

  assert.throws(
    () =>
      mergeProductCatalog({ schemaVersion: 1, entries: [] }, {
        schemaVersion: 1,
        entries: [
          productEntry,
          { ...productEntry, id: 'pi-alias', outputId: 'pi' }
        ]
      }),
    /Product catalog output path conflicts/u
  )
})

test('distribution sync exclusions match only declared consumer prefixes', () => {
  const prefixes = ['assets/homepage/']

  assert.equal(isDistributionTargetExcluded('assets/homepage/apps/homepage/social.png', prefixes), true)
  assert.equal(isDistributionTargetExcluded('assets/brand/distribution/homepage.png', prefixes), false)
})

test('distribution catalog references configured scenes and safe links', () => {
  const distribution = readDistribution()
  assert.equal(distribution.surfaces.length, 11)
  assert.equal(new Set(distribution.surfaces.map(surface => surface.id)).size, 11)
  assert.ok(distribution.surfaces.some(surface => surface.id === 'github-org-avatar' && surface.status === 'manual'))
  assert.ok(
    distribution.surfaces.some(surface =>
      surface.id === 'x-profile-header' && surface.studioScene === 'x-profile-header'
    )
  )
  assert.ok(distribution.surfaces.every(surface => surface.preview != null))
  assert.ok(distribution.surfaces.every(surface => surface.quickLinks.every(link => link.url.startsWith('https://'))))
  for (const surface of distribution.surfaces.filter(surface => surface.studioScene != null)) {
    assert.deepEqual(surface.preview, {
      light: `dist/${surface.studioScene}-light.png`,
      dark: `dist/${surface.studioScene}-dark.png`
    })
  }
  const deployments = distribution.surfaces.flatMap(surface => surface.deployments ?? [])
  assert.equal(deployments.length, 21)
  assert.ok(deployments.every(deployment => deployment.theme === 'light' || deployment.theme === 'dark'))
})

test('X header draws the Org layout natively at its own dimensions', () => {
  const catalog = readCatalog()
  const { html } = compileStudio({ write: false })
  const xScene = html.slice(html.indexOf('<div class="x-profile-header">'))
  assert.ok(!xScene.includes('x-profile-header__org-source'))
  assert.ok(!xScene.includes('gravity-scene-copy gravity-copy'))
  for (const kind of ['adapter', 'model-service', 'channel']) {
    const tier = xOrbitTiers[kind]
    const entries = enabledEntries(catalog, kind)
    assert.match(xScene, new RegExp(`data-orbit-tier="${kind}"`))
    entries.forEach((entry, index) => {
      const angle = orbitAngle(tier, index, entries.length)
      const [x, y] = orbitPoint(tier, angle)
      assert.ok(
        xScene.includes(
          `data-catalog-id="${entry.id}" data-catalog-kind="${kind}" data-orbit-angle="${
            angle.toFixed(2)
          }" data-orbit-tier="${kind}" style="--x:${x.toFixed(2)};--y:${y.toFixed(2)}"`
        )
      )
      assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100)
    })
  }
  assert.deepEqual(xOrbitCenter, [50, 53])
  assert.deepEqual(xGravityWells, [
    { center: [15, 47], strength: .72 },
    { center: [50, 23.5], strength: .66 }
  ])
  assert.deepEqual(Object.fromEntries(Object.entries(xOrbitTiers).map(([kind, tier]) => [kind, tier.orbitScale])), {
    adapter: 1.38,
    'model-service': 1.28,
    channel: 1.2
  })
  assert.deepEqual(gravityWarpPoint([50, 23.5], [xGravityWells[1]]), [50, 23.5])
  const unwarpedOuterPoint = [xOrbitCenter[0] + xOrbitTiers.channel.radiusX, xOrbitCenter[1] / 2]
  assert.notDeepEqual(gravityWarpPoint(unwarpedOuterPoint, xGravityWells), unwarpedOuterPoint)
  assert.ok(Math.min(...Object.values(xOrbitTiers).map(tier => tier.rotation)) <= -30)
  assert.ok(Math.max(...Object.values(xOrbitTiers).map(tier => tier.rotation)) >= 30)
  assert.ok(html.includes('.runtime-network--x .orbit-trail {'))
  assert.ok(html.includes('stroke-dasharray: 9.6 12.8'))
  assert.ok(html.includes('stroke-width: 4'))
})
