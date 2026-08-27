import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import { captureScreenshotWithRetry, removePartialScreenshot, waitForScreenshot } from './screenshot.mjs'

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

const crc32 = bytes => {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const chunk = (type, data = Buffer.alloc(0)) => {
  const bytes = Buffer.alloc(data.length + 12)
  bytes.writeUInt32BE(data.length, 0)
  bytes.write(type, 4, 'ascii')
  data.copy(bytes, 8)
  bytes.writeUInt32BE(crc32(bytes.subarray(4, data.length + 8)), data.length + 8)
  return bytes
}

const createPng = ({ height, idatData, includeIdat = true, includeIend = true, width }) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const chunks = [chunk('IHDR', header)]
  if (includeIdat) chunks.push(chunk('IDAT', idatData ?? deflateSync(Buffer.alloc(height * (width * 4 + 1)))))
  if (includeIend) chunks.push(chunk('IEND'))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks])
}

const completedBrowser = () => Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null })

test('retries a transient screenshot failure once and cleans the partial output', async () => {
  const attempts = []
  let cleanups = 0

  const result = await captureScreenshotWithRetry({
    capture: async attempt => {
      attempts.push(attempt)
      if (attempt === 1) throw new Error('Chrome did not write the screenshot')
      return 'captured'
    },
    cleanup: async () => { cleanups += 1 }
  })

  assert.equal(result, 'captured')
  assert.deepEqual(attempts, [1, 2])
  assert.equal(cleanups, 1)
})

test('stops after the configured screenshot retry limit and cleans every failed attempt', async () => {
  let attempts = 0
  let cleanups = 0

  await assert.rejects(
    captureScreenshotWithRetry({
      attempts: 2,
      capture: async () => {
        attempts += 1
        throw new Error('deterministic rendering failure')
      },
      cleanup: async () => { cleanups += 1 }
    }),
    {
      message: 'Screenshot capture failed after 2 attempts'
    }
  )

  assert.equal(attempts, 2)
  assert.equal(cleanups, 2)
})

test('removes a partial screenshot before the next capture', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'oneworks-brand-studio-test-'))
  const screenshot = resolve(directory, 'partial.png')
  writeFileSync(screenshot, 'partial')

  removePartialScreenshot(screenshot)

  assert.equal(existsSync(screenshot), false)
})

test('accepts only a completed Chrome process with matching PNG dimensions', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'oneworks-brand-studio-test-'))
  const screenshot = resolve(directory, 'complete.png')
  writeFileSync(screenshot, createPng({ height: 1, width: 1 }))

  await waitForScreenshot({
    browserProcess: completedBrowser(),
    height: 1,
    path: screenshot,
    pollIntervalMs: 1,
    timeoutMs: 10,
    width: 1
  })
})

test('rejects incomplete, corrupt, and wrong-sized screenshots after Chrome completes', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'oneworks-brand-studio-test-'))
  const screenshot = resolve(directory, 'invalid.png')

  writeFileSync(screenshot, Buffer.from([137, 80, 78, 71]))
  await assert.rejects(
    waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 }),
    /truncated/
  )

  writeFileSync(screenshot, createPng({ height: 1, width: 2 }))
  await assert.rejects(
    waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 }),
    /do not match/
  )

  const invalidCrc = createPng({ height: 1, width: 1 })
  invalidCrc[28] ^= 0xff
  writeFileSync(screenshot, invalidCrc)
  await assert.rejects(
    waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 }),
    /invalid IHDR CRC/
  )

  writeFileSync(screenshot, createPng({ height: 1, includeIdat: false, width: 1 }))
  await assert.rejects(
    waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 }),
    /missing IDAT/
  )

  writeFileSync(screenshot, createPng({ height: 1, includeIend: false, width: 1 }))
  await assert.rejects(
    waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 }),
    /missing its IEND/
  )

  writeFileSync(screenshot, Buffer.concat([createPng({ height: 1, width: 1 }), Buffer.from([0])]))
  await assert.rejects(
    waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 }),
    /trailing data/
  )
})

test('retries invalid raster payloads, including over-expansion, twice and cleans each failed output and profile', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'oneworks-brand-studio-test-'))
  const screenshot = resolve(directory, 'invalid-raster.png')
  const invalidPngs = [
    createPng({ height: 1, idatData: Buffer.alloc(0), width: 1 }),
    createPng({ height: 1, idatData: Buffer.from('not-deflate'), width: 1 }),
    createPng({ height: 1, idatData: deflateSync(Buffer.alloc(1)), width: 1 }),
    createPng({ height: 1, idatData: deflateSync(Buffer.alloc(6)), width: 1 }),
    createPng({ height: 1, idatData: deflateSync(Buffer.from([5, 0, 0, 0, 0])), width: 1 })
  ]

  for (const invalidPng of invalidPngs) {
    let attempts = 0
    let outputCleanups = 0
    let profileCleanups = 0

    await assert.rejects(
      captureScreenshotWithRetry({
        capture: async () => {
          attempts += 1
          writeFileSync(screenshot, invalidPng)
          try {
            await waitForScreenshot({ browserProcess: completedBrowser(), height: 1, path: screenshot, width: 1 })
          } finally {
            profileCleanups += 1
          }
        },
        cleanup: async () => {
          removePartialScreenshot(screenshot)
          outputCleanups += 1
        }
      }),
      /failed after 2 attempts/
    )

    assert.equal(attempts, 2)
    assert.equal(outputCleanups, 2)
    assert.equal(profileCleanups, 2)
    assert.equal(existsSync(screenshot), false)
  }
})

test('turns a Chrome launch error into a retryable screenshot failure', async () => {
  const browserProcess = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null })
  const pending = waitForScreenshot({
    browserProcess,
    height: 630,
    path: resolve(tmpdir(), 'never-created.png'),
    pollIntervalMs: 1,
    timeoutMs: 50,
    width: 1200
  })
  browserProcess.emit('error', new Error('missing Chrome binary'))

  await assert.rejects(pending, /Chrome failed to launch: missing Chrome binary/)
})
