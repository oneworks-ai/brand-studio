import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  enabledEntries,
  readCatalog,
  readDistribution,
  readStudioConfig,
  root,
  sha256
} from './catalog.mjs'
import { syncProductAssets } from './sync-product-catalog.mjs'

const templatePath = resolve(root, 'src/studio.template.html')
const outputPath = resolve(root, 'index.html')
const escapeHtml = value => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const serializeForInlineScript = value => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029')

const icons = {
  android: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M8 8 6.5 5.5M16 8l1.5-2.5M8 12h.01M16 12h.01M8 19v2M16 19v2"/>',
  chrome: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M20.2 8H12M7.9 19.1 12 12M3.8 8l4.1 7.1"/>',
  desktop: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  github: '<path d="M9 19c-4.5 1.4-4.5-2.3-6-2.8M15 22v-3.9c0-1.1.1-1.6-.5-2.2 3-.3 6.2-1.5 6.2-6.7A5.2 5.2 0 0 0 19.3 5 4.8 4.8 0 0 0 19.2 1S18.1.7 15 2.6a13.4 13.4 0 0 0-6 0C5.9.7 4.8 1 4.8 1a4.8 4.8 0 0 0-.1 4A5.2 5.2 0 0 0 3.3 9.2c0 5.2 3.2 6.4 6.2 6.7-.5.5-.7 1.1-.6 2.2V22"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  homepage: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  npm: '<path d="M3 7h18v10H11v-7H8v7H3Z"/>',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.5 7.7 7.5 4.2 7.5-4.2M12 12v9"/>',
  upload: '<path d="M12 16V4m0 0L8 8m4-4 4 4M5 20h14"/>',
  vscode: '<path d="m17 3-8 7-4-3-2 2 4 3-4 3 2 2 4-3 8 7 4-2V5Z"/><path d="M17 8v8l-5-4Z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  x: '<path d="M5 4 19 20M19 4 5 20"/>'
}

const icon = name => `<svg class="studio-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`

const platformIconNames = {
  Android: 'android',
  Chrome: 'chrome',
  Desktop: 'desktop',
  GitHub: 'github',
  Homepage: 'homepage',
  npm: 'npm',
  'VS Code': 'vscode',
  'Web / PWA': 'web',
  'X / Twitter': 'x'
}

const layouts = {
  repo: {
    center: [73, 45],
    orbitScale: 1.16,
    safeInset: 2.5,
    positions: {
      adapter: [[46, 18], [62, 14], [83, 22], [88, 48], [82, 76], [62, 84]],
      'model-service': [[48, 48], [47, 74], [56, 34], [68, 70], [55, 58]],
      channel: [[34, 8], [52, 5], [75, 5], [96, 22], [96, 80], [60, 92]]
    }
  },
  home: {
    center: [75, 39],
    orbitScale: 1.16,
    safeInset: 4,
    positions: {
      adapter: [[68, 20], [87, 39], [80, 66], [63, 39], [88, 70], [54, 74]],
      'model-service': [[94, 28], [75, 10], [86, 56], [64, 60], [60, 28]],
      channel: [[45, 8], [62, 4], [82, 5], [96, 44], [94, 88], [70, 94]]
    }
  }
}

export const xOrbitCenter = [50, 53]
export const xGravityWells = [
  { center: [15, 47], strength: .72 },
  { center: [50, 23.5], strength: .66 }
]
export const xOrbitTiers = {
  adapter: {
    angles: [13.55, 84.69, 153.24, -128.47, -62.99, -21],
    className: 'orbit-trail--soft orbit-trail--cyan',
    orbitScale: 1.38,
    radiusX: 16.26,
    radiusY: 22.37,
    rotation: 30
  },
  'model-service': {
    angles: [42.03, 104.66, -179.99, -104.67, -42.04],
    className: 'orbit-trail--violet',
    orbitScale: 1.28,
    radiusX: 23.09,
    radiusY: 21.15,
    rotation: 0
  },
  channel: {
    angles: [13.20, 74.72, 122.22, -166.80, -105.28, -57.78],
    className: 'orbit-trail--soft orbit-trail--amber',
    orbitScale: 1.20,
    radiusX: 24,
    radiusY: 28,
    rotation: -30
  }
}

export const gravityWarpPoint = ([x, y], wells, fieldRadius = 18) => {
  return wells.reduce(([warpedX, warpedY], { center, strength }) => {
    const dx = warpedX - center[0]
    const dy = warpedY - center[1]
    const influence = Math.exp(-(dx * dx + dy * dy) / (2 * fieldRadius * fieldRadius))
    const scale = 1 - strength * influence
    return [center[0] + dx * scale, center[1] + dy * scale]
  }, [x, y])
}

const baseOrbitPoint = (tier, angle) => {
  const canvasAspect = 3
  const radians = angle * Math.PI / 180
  const rotation = tier.rotation * Math.PI / 180
  const localX = Math.cos(radians) * tier.radiusX * tier.orbitScale
  const localY = Math.sin(radians) * tier.radiusY * tier.orbitScale
  return [
    xOrbitCenter[0] + localX * Math.cos(rotation) - localY / canvasAspect * Math.sin(rotation),
    xOrbitCenter[1] + localX * canvasAspect * Math.sin(rotation) + localY * Math.cos(rotation)
  ]
}

export const orbitPoint = (tier, angle) => {
  const [x, cssY] = baseOrbitPoint(tier, angle)
  const [warpedX, warpedPathY] = gravityWarpPoint([x, cssY / 2], xGravityWells)
  return [warpedX, warpedPathY * 2]
}

export const orbitAngle = (tier, itemIndex, itemCount) => {
  return tier.angles[itemIndex] ?? itemIndex * 360 / Math.max(1, itemCount)
}

const renderOrbitPath = tier => {
  const steps = 180
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = index * 360 / steps
    const [x, cssY] = orbitPoint(tier, angle)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${(cssY / 2).toFixed(2)}`
  }).join(' ')
}

const fallbackPosition = ({ center, kindIndex, itemIndex }) => {
  const radius = 24 + kindIndex * 9
  const angle = (-110 + itemIndex * 137.508 + kindIndex * 23) * Math.PI / 180
  return [
    Math.max(4, Math.min(96, center[0] + Math.cos(angle) * radius)),
    Math.max(4, Math.min(96, center[1] + Math.sin(angle) * radius * 1.42))
  ]
}

const nodeClass = entry => {
  const classes = [entry.kind === 'adapter' ? 'runtime-node' : `${entry.kind === 'model-service' ? 'provider' : 'channel'}-node`]
  if (entry.themeAdaptive === true) classes.push('is-theme-adaptive')
  return classes.join(' ')
}

const imageMarkup = entry => {
  const label = escapeHtml(entry.label)
  const icon = escapeHtml(entry.icon)
  if (entry.darkIcon) {
    const darkIcon = escapeHtml(entry.darkIcon)
    return `<img class="mode-image" data-light-src="${icon}" data-dark-src="${darkIcon}" src="${darkIcon}" alt="${label}">`
  }
  return `<img src="${icon}" alt="${label}">`
}

const curvedLink = ([x, y], [centerX, centerY], index) => {
  const pathY = y / 2
  const centerPathY = centerY / 2
  const dx = centerX - x
  const dy = centerPathY - pathY
  const bend = (index % 2 === 0 ? 1 : -1) * Math.min(4.8, Math.hypot(dx, dy) * .14)
  const length = Math.max(1, Math.hypot(dx, dy))
  const normalX = -dy / length * bend
  const normalY = dx / length * bend
  const controlOneX = x + dx * .34 + normalX
  const controlOneY = pathY + dy * .34 + normalY
  const controlTwoX = x + dx * .72 + normalX * .4
  const controlTwoY = pathY + dy * .72 + normalY * .4
  return `M${x.toFixed(2)} ${pathY.toFixed(2)} C${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)} ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)} ${centerX.toFixed(2)} ${centerPathY.toFixed(2)}`
}

const renderSurface = (surface, catalog) => {
  const layout = layouts[surface]
  const kinds = ['adapter', 'model-service', 'channel']
  const nodes = []
  const links = []
  let linkIndex = 0

  kinds.forEach((kind, kindIndex) => {
    enabledEntries(catalog, kind).forEach((entry, itemIndex) => {
      const basePosition = layout.positions[kind][itemIndex] ?? fallbackPosition({
        center: layout.center,
        itemIndex,
        kindIndex
      })
      const inset = layout.safeInset
      const position = [
        Math.max(inset, Math.min(100 - inset, layout.center[0] + (basePosition[0] - layout.center[0]) * layout.orbitScale)),
        Math.max(inset, Math.min(100 - inset, layout.center[1] + (basePosition[1] - layout.center[1]) * layout.orbitScale))
      ]
      const [x, y] = position
      links.push(curvedLink(position, layout.center, linkIndex))
      nodes.push(
        `<div class="${nodeClass(entry)}" data-catalog-id="${entry.id}" data-catalog-kind="${entry.kind}" style="--x:${x.toFixed(2)};--y:${y.toFixed(2)}" title="${escapeHtml(entry.label)}">${imageMarkup(entry)}</div>`
      )
      linkIndex += 1
    })
  })

  return [
    `<svg class="runtime-network__lines catalog-links" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><path class="orbit-link" data-generated="true" d="${links.join(' ')}" /></svg>`,
    ...nodes
  ].join('\n            ')
}

const renderXSurface = catalog => {
  const kinds = ['adapter', 'model-service', 'channel']
  const tracks = kinds.map(kind => {
    const tier = xOrbitTiers[kind]
    return `<path class="orbit-trail ${tier.className}" data-orbit-tier="${kind}" d="${renderOrbitPath(tier)}" />`
  }).join('\n                ')
  const nodes = kinds.flatMap(kind => {
    const entries = enabledEntries(catalog, kind)
    const tier = xOrbitTiers[kind]
    return entries.map((entry, itemIndex) => {
      const angle = orbitAngle(tier, itemIndex, entries.length)
      const [x, y] = orbitPoint(tier, angle)
      return `<div class="${nodeClass(entry)}" data-catalog-id="${entry.id}" data-catalog-kind="${entry.kind}" data-orbit-angle="${angle.toFixed(2)}" data-orbit-tier="${kind}" style="--x:${x.toFixed(2)};--y:${y.toFixed(2)}" title="${escapeHtml(entry.label)}">${imageMarkup(entry)}</div>`
    })
  }).join('\n              ')

  return `<svg class="runtime-network__lines" viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
                ${tracks}
              </svg>
              ${nodes}
              <div class="runtime-hub"><img class="mode-image" data-light-src="#ow-img-0" data-dark-src="#ow-img-1" src="#ow-img-1" alt="One Works"></div>`
}

const renderGravityGrid = ({ wells }) => {
  const path = points => points.map((point, index) => {
    const [x, y] = gravityWarpPoint(point, wells)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
  const paths = []
  for (let x = -14; x <= 114; x += 8) {
    paths.push(`<path d="${path(Array.from({ length: 36 }, (_, index) => [x, -10 + index * 2]))}" />`)
  }
  for (let y = -10; y <= 60; y += 5) {
    paths.push(`<path d="${path(Array.from({ length: 53 }, (_, index) => [-15 + index * 2.5, y]))}" />`)
  }
  return paths.join('\n              ')
}

const statusLabels = {
  automated: '自动同步',
  hybrid: '部分自动',
  manual: '人工上传'
}

const previewMarkup = surface => {
  const preview = typeof surface.preview === 'string'
    ? { default: surface.preview }
    : surface.preview
  const extension = path => path.slice(path.lastIndexOf('.'))
  const previewUrl = (theme, path) => path.startsWith('dist/')
    ? path
    : `assets/distribution/${surface.id}-${theme}${extension(path)}`
  if (preview.default) {
    return `<img src="${previewUrl('default', preview.default)}" alt="${escapeHtml(surface.surface)} 当前资源预览">`
  }
  return `<img class="mode-image" data-light-src="${previewUrl('light', preview.light)}" data-dark-src="${previewUrl('dark', preview.dark)}" src="${previewUrl('dark', preview.dark)}" alt="${escapeHtml(surface.surface)} 当前资源预览">`
}

const renderDistributionSurface = (surface, sceneByName) => {
  const actions = surface.quickLinks.map(link => (
    `<a class="btn btn-ghost" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${icon('external')}<span>${escapeHtml(link.label)}</span></a>`
  )).join('')
  const artifacts = surface.artifacts.map(artifact => `<code>${escapeHtml(artifact)}</code>`).join('')
  const updateMethod = surface.updateMethod.map(step => `<li>${escapeHtml(step)}</li>`).join('')
  const pitfalls = surface.pitfalls.map(pitfall => `<li>${escapeHtml(pitfall)}</li>`).join('')
  const scene = surface.studioScene == null ? undefined : sceneByName.get(surface.studioScene)
  const exportInfo = scene == null
    ? ''
    : `<span class="distribution-item__export">${icon('image')}<span>最新导出 · ${scene.width} × ${scene.height} · 亮 / 暗</span></span>`
  const manifestInfo = scene == null
    ? ''
    : `<p data-distribution-manifest-scene="${scene.name}"><strong>当前导出</strong>正在读取生成清单…</p>`
  const optionalExportInfo = exportInfo === '' ? '' : `\n            ${exportInfo}`
  const optionalManifestInfo = manifestInfo === '' ? '' : `\n          ${manifestInfo}`
  const studioAction = surface.studioScene == null
    ? ''
    : `<a class="btn" href="?scene=${surface.studioScene}">${icon('image')}<span>打开场景</span></a>`
  const searchText = [
    surface.id,
    surface.platform,
    surface.surface,
    ...surface.artifacts,
    ...surface.quickLinks.map(link => link.label)
  ].join(' ').toLocaleLowerCase()

  return `<article class="distribution-item" data-distribution-id="${surface.id}" data-distribution-platform="${escapeHtml(surface.platform)}" data-distribution-search="${escapeHtml(searchText)}">
        <div class="distribution-item__main">
          <div class="distribution-item__preview">${previewMarkup(surface)}</div>
          <div class="distribution-item__identity">
            <span>${icon(platformIconNames[surface.platform])}${escapeHtml(surface.platform)}</span>
            <h2>${escapeHtml(surface.surface)}</h2>${optionalExportInfo}
          </div>
          <span class="distribution-status" data-status="${surface.status}">${statusLabels[surface.status]}</span>
          <div class="distribution-item__artifacts"><small>落地目标</small>${artifacts}</div>
          <div class="distribution-item__actions">${studioAction}${actions}</div>
          <button class="btn distribution-item__toggle" type="button" aria-expanded="false">${icon('info')}<span>维护说明</span></button>
        </div>
        <div class="distribution-item__details" hidden>
          <section><h3>更新方式</h3><ol>${updateMethod}</ol></section>
          <section><h3>坑点</h3><ul>${pitfalls}</ul></section>${optionalManifestInfo}
          <p><strong>自动化边界</strong>${escapeHtml(surface.automation)}</p>
        </div>
      </article>`
}

export const compileStudio = ({ write = true } = {}) => {
  if (write) syncProductAssets()
  const catalog = readCatalog()
  const config = readStudioConfig()
  const distribution = readDistribution(config)
  const sceneByName = new Map(config.scenes.map(scene => [scene.name, scene]))
  let html = readFileSync(templatePath, 'utf8')

  for (const surface of Object.keys(layouts)) {
    const marker = `<!-- BRAND_STUDIO_NODES:${surface} -->`
    if (!html.includes(marker)) throw new Error(`Missing template marker: ${marker}`)
    html = html.replace(marker, renderSurface(surface, catalog))
  }

  const xMarker = '<!-- BRAND_STUDIO_ORBITS_AND_NODES:x -->'
  if (!html.includes(xMarker)) throw new Error(`Missing template marker: ${xMarker}`)
  html = html.replace(xMarker, renderXSurface(catalog))

  const xGridMarker = '<!-- BRAND_STUDIO_GRID:x -->'
  if (!html.includes(xGridMarker)) throw new Error(`Missing template marker: ${xGridMarker}`)
  html = html.replace(xGridMarker, renderGravityGrid({
    wells: xGravityWells
  }))

  const scenes = Object.fromEntries(config.scenes.map(scene => [scene.name, {
    article: scene.article,
    height: scene.height,
    label: scene.label ?? scene.name,
    themes: scene.themes,
    width: scene.width
  }]))
  const sceneData = serializeForInlineScript(scenes)
  if (!html.includes('/* BRAND_STUDIO_SCENES */ {}')) throw new Error('Missing scene registry marker')
  html = html.replaceAll('/* BRAND_STUDIO_SCENES */ {}', sceneData)

  const sceneCards = config.scenes.map((scene, index) => {
    const label = escapeHtml(scene.label ?? scene.name)
    return `<button class="studio-scene-card" type="button" data-studio-select-scene="${scene.name}" aria-pressed="${index === 0}">
          <img class="mode-image" data-light-src="dist/${scene.name}-light.png" data-dark-src="dist/${scene.name}-dark.png" src="dist/${scene.name}-dark.png" alt="${label} 预览">
          <span><strong>${label}</strong><small>${scene.width} × ${scene.height}</small></span>
        </button>`
  }).join('\n        ')
  if (!html.includes('<!-- BRAND_STUDIO_SCENE_CARDS -->')) throw new Error('Missing scene cards marker')
  html = html.replace('<!-- BRAND_STUDIO_SCENE_CARDS -->', sceneCards)

  const distributionPlatforms = [...new Set(distribution.surfaces.map(surface => surface.platform))]
  const distributionFilters = [
    `<button class="btn" type="button" data-distribution-filter="all" aria-pressed="true">${icon('grid')}<span>全部</span></button>`,
    ...distributionPlatforms.map(platform => (
      `<button class="btn" type="button" data-distribution-filter="${escapeHtml(platform)}" aria-pressed="false">${icon(platformIconNames[platform])}<span>${escapeHtml(platform)}</span></button>`
    ))
  ].join('')
  const distributionSurfaces = distribution.surfaces.map(surface => renderDistributionSurface(surface, sceneByName)).join('\n      ')
  const distributionSummary = `${distribution.surfaces.length} 个投放位置 · ${config.scenes.length} 个场景 · ${config.scenes.reduce((count, scene) => count + scene.themes.length, 0)} 张精确 PNG`
  if (!html.includes('<!-- BRAND_STUDIO_DISTRIBUTION_FILTERS -->')) {
    throw new Error('Missing distribution filters marker')
  }
  if (!html.includes('<!-- BRAND_STUDIO_DISTRIBUTION_SURFACES -->')) {
    throw new Error('Missing distribution surfaces marker')
  }
  html = html
    .replace('<!-- BRAND_STUDIO_DISTRIBUTION_FILTERS -->', distributionFilters)
    .replace('<!-- BRAND_STUDIO_DISTRIBUTION_SURFACES -->', distributionSurfaces)
    .replace('<!-- BRAND_STUDIO_DISTRIBUTION_SUMMARY -->', distributionSummary)

  if (write) writeFileSync(outputPath, html)
  return {
    catalog,
    distribution,
    html,
    sha256: sha256(html)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = compileStudio()
  process.stdout.write(`Compiled Brand Studio from ${result.catalog.entries.length} catalog entries.\n`)
}
