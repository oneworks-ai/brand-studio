import { existsSync, readFileSync, rmSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export const screenshotAttempts = 2
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const maxScreenshotScanlineBytes = 64 * 1024 * 1024
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

const channelsByColorType = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4]
])

const bitDepthsByColorType = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])]
])

const validateScreenshotPng = ({ bytes, height, width }) => {
  if (bytes.length < pngSignature.length) throw new Error('Screenshot PNG is truncated before its signature')
  if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error('Screenshot is not a PNG file')
  let offset = pngSignature.length
  let chunkIndex = 0
  const idatChunks = []
  let ihdr
  let expectedScanlineLength

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error('Screenshot PNG is truncated in a chunk header')
    const length = bytes.readUInt32BE(offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (dataEnd > bytes.length - 4 || chunkEnd > bytes.length) throw new Error('Screenshot PNG is truncated in chunk data')

    const type = bytes.toString('ascii', offset + 4, dataStart)
    const data = bytes.subarray(dataStart, dataEnd)
    if (bytes.readUInt32BE(dataEnd) !== crc32(bytes.subarray(offset + 4, dataEnd))) {
      throw new Error(`Screenshot PNG has an invalid ${type} CRC`)
    }
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Screenshot PNG must begin with a 13-byte IHDR chunk')
      const actualWidth = data.readUInt32BE(0)
      const actualHeight = data.readUInt32BE(4)
      if (actualWidth !== width || actualHeight !== height) {
        throw new Error(`Screenshot dimensions ${actualWidth}x${actualHeight} do not match ${width}x${height}`)
      }
      const bitDepth = data[8]
      const colorType = data[9]
      if (actualWidth === 0 || actualHeight === 0 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Screenshot PNG must use non-interlaced compression and filter method 0')
      }
      if (!bitDepthsByColorType.get(colorType)?.has(bitDepth)) {
        throw new Error(`Screenshot PNG has unsupported color type ${colorType} and bit depth ${bitDepth}`)
      }
      const channels = channelsByColorType.get(colorType)
      const rowBits = actualWidth * channels * bitDepth
      const rowBytes = Math.ceil(rowBits / 8)
      expectedScanlineLength = actualHeight * (rowBytes + 1)
      if (!Number.isSafeInteger(rowBits) || !Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(expectedScanlineLength) || expectedScanlineLength > maxScreenshotScanlineBytes) {
        throw new Error('Screenshot PNG has an unreasonable scanline size')
      }
      ihdr = { bitDepth, colorType, height: actualHeight, width: actualWidth }
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('Screenshot PNG has a non-empty IEND chunk')
      if (idatChunks.length === 0) throw new Error('Screenshot PNG is missing IDAT data')
      if (chunkEnd !== bytes.length) throw new Error('Screenshot PNG has trailing data after IEND')
      let scanlines
      try {
        scanlines = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedScanlineLength })
      } catch (error) {
        throw new Error('Screenshot PNG has invalid IDAT deflate data', { cause: error })
      }
      if (scanlines.length !== expectedScanlineLength) {
        throw new Error(`Screenshot PNG scanline length ${scanlines.length} does not match ${expectedScanlineLength}`)
      }
      const rowBytes = Math.ceil((ihdr.width * channelsByColorType.get(ihdr.colorType) * ihdr.bitDepth) / 8)
      for (let row = 0; row < ihdr.height; row += 1) {
        const filter = scanlines[row * (rowBytes + 1)]
        if (filter > 4) throw new Error(`Screenshot PNG has invalid filter type ${filter}`)
      }
      return
    }
    offset = chunkEnd
    chunkIndex += 1
  }

  throw new Error('Screenshot PNG is missing its IEND chunk')
}

export const waitForScreenshot = async ({ browserProcess, height, path, width, timeoutMs = 20_000, pollIntervalMs = 100 }) => {
  const deadline = Date.now() + timeoutMs
  let launchError
  const onLaunchError = error => { launchError = error }
  browserProcess.on('error', onLaunchError)

  while (Date.now() < deadline) {
    if (launchError) throw new Error(`Chrome failed to launch: ${launchError.message}`, { cause: launchError })
    const exited = browserProcess.exitCode != null || browserProcess.signalCode != null
    if (exited) {
      if (browserProcess.exitCode !== 0 || browserProcess.signalCode != null) {
        throw new Error(`Chrome exited before writing ${path} (code ${browserProcess.exitCode}, signal ${browserProcess.signalCode})`)
      }
      if (!existsSync(path)) throw new Error(`Chrome completed without writing ${path}`)
      validateScreenshotPng({ bytes: readFileSync(path), height, width })
      return
    }
    await new Promise(resolveWait => setTimeout(resolveWait, pollIntervalMs))
  }
  if (launchError) throw new Error(`Chrome failed to launch: ${launchError.message}`, { cause: launchError })
  throw new Error(`Timed out waiting for Chrome to complete ${path}`)
}

export const captureScreenshotWithRetry = async ({ capture, cleanup, attempts = screenshotAttempts }) => {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await capture(attempt)
    } catch (error) {
      lastError = error
      await cleanup()
    }
  }

  throw new Error(`Screenshot capture failed after ${attempts} attempts`, { cause: lastError })
}

export const removePartialScreenshot = path => {
  rmSync(path, { force: true })
}
