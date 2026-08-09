import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = JSON.parse(readFileSync(resolve(root, 'studio.config.json'), 'utf8'))
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

const waitForScreenshot = async (path, browserProcess) => {
  const deadline = Date.now() + 20_000
  let previousSize = -1
  let stableReads = 0

  while (Date.now() < deadline) {
    if (browserProcess.exitCode != null && !existsSync(path)) {
      throw new Error(`Chrome exited with ${browserProcess.exitCode} before writing ${path}`)
    }
    if (existsSync(path)) {
      const size = statSync(path).size
      stableReads = size > 0 && size === previousSize ? stableReads + 1 : 0
      previousSize = size
      if (stableReads >= 2) return
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for ${path}`)
}

const stopBrowser = async (browserProcess, profile) => {
  browserProcess.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => browserProcess.once('exit', resolveExit)),
    new Promise(resolveWait => setTimeout(resolveWait, 2_000))
  ])
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
      const outputPath = resolve(outputDirectory, filename)
      const url = `http://${host}:${port}/?scene=${encodeURIComponent(scene.name)}&theme=${theme}&export=1`
      rmSync(outputPath, { force: true })
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

      await waitForScreenshot(outputPath, browserProcess)
      await stopBrowser(browserProcess, chromeProfile)

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
  source: 'index.html',
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  artifacts
}
writeFileSync(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Rendered ${artifacts.length} exact scene exports.\n`)
