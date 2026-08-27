import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { catalogInputs, readCatalog, readStudioConfig, resolveContained } from './catalog.mjs'
import { captureScreenshotWithRetry, removePartialScreenshot, waitForScreenshot } from './screenshot.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = readStudioConfig()
const catalog = readCatalog()
const sourcePath = resolve(root, 'index.html')
const outputDirectory = resolve(root, 'dist')
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const host = '127.0.0.1'

mkdirSync(outputDirectory, { recursive: true })

const readinessServer = createServer()
await new Promise((resolveListen, rejectListen) => {
  readinessServer.once('error', rejectListen)
  readinessServer.listen(0, host, resolveListen)
})
const address = readinessServer.address()
const port = typeof address === 'object' && address ? address.port : 4173
await new Promise(resolveClose => readinessServer.close(resolveClose))

const server = spawn(process.execPath, [resolve(root, 'scripts/serve.mjs')], {
  cwd: root,
  env: { ...process.env, HOST: host, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit']
})

await new Promise((resolveReady, rejectReady) => {
  const timeout = setTimeout(() => rejectReady(new Error('Brand Studio server did not become ready')), 10_000)
  server.once('exit', code => rejectReady(new Error(`Brand Studio server exited with ${code}`)))
  server.stdout.on('data', chunk => {
    if (!chunk.toString().includes('One Works Brand Studio:')) return
    clearTimeout(timeout)
    resolveReady()
  })
})

const artifacts = []

const stopBrowser = async (browserProcess, profile) => {
  if (browserProcess.exitCode == null && browserProcess.signalCode == null) {
    browserProcess.kill('SIGTERM')
    await Promise.race([
      new Promise(resolveExit => browserProcess.once('exit', resolveExit)),
      new Promise(resolveWait => setTimeout(resolveWait, 2_000))
    ])
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { force: true, recursive: true })
      return
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 4) throw error
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
  }
}

try {
  for (const scene of config.scenes) {
    for (const theme of scene.themes) {
      const filename = `${scene.name}-${theme}.png`
      const outputPath = resolveContained(outputDirectory, filename, 'render output')
      if (scene.frozen === true) {
        if (!existsSync(outputPath)) throw new Error(`Frozen scene artifact is missing: ${filename}`)
        const bytes = readFileSync(outputPath)
        artifacts.push({
          file: `dist/${filename}`,
          height: scene.height,
          scene: scene.name,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          theme,
          width: scene.width
        })
        continue
      }
      const url = `http://${host}:${port}/?scene=${encodeURIComponent(scene.name)}&theme=${theme}&export=1&width=${scene.width}&height=${scene.height}`
      await captureScreenshotWithRetry({
        capture: async () => {
          removePartialScreenshot(outputPath)
          const chromeProfile = mkdtempSync(resolve(tmpdir(), 'oneworks-brand-studio-'))
          const browserProcess = spawn(chrome, [
            '--headless=new',
            '--hide-scrollbars',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-sync',
            '--run-all-compositor-stages-before-draw',
            '--force-device-scale-factor=1',
            '--virtual-time-budget=2500',
            `--user-data-dir=${chromeProfile}`,
            `--window-size=${scene.width},${scene.height}`,
            `--screenshot=${outputPath}`,
            url
          ], { stdio: 'ignore' })

          try {
            await waitForScreenshot({
              browserProcess,
              height: scene.height,
              path: outputPath,
              width: scene.width
            })
          } finally {
            await stopBrowser(browserProcess, chromeProfile)
          }
        },
        cleanup: async () => removePartialScreenshot(outputPath)
      })

      const bytes = readFileSync(outputPath)
      artifacts.push({
        file: `dist/${filename}`,
        height: scene.height,
        scene: scene.name,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        theme,
        width: scene.width
      })
    }
  }
} finally {
  server.kill('SIGTERM')
}

const sourceBytes = readFileSync(sourcePath)
const manifest = {
  schemaVersion: 1,
  catalog: 'catalog/catalog.json',
  catalogEntries: catalog.entries.length,
  inputs: catalogInputs(catalog),
  source: 'index.html',
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  artifacts
}
writeFileSync(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Rendered ${artifacts.length} exact scene exports.\n`)
