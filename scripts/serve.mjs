import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number.parseInt(process.env.PORT ?? '4173', 10)
const host = process.env.HOST ?? '127.0.0.1'

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const candidate = resolve(root, relativePath)

  if (!candidate.startsWith(`${root}${sep}`) || !existsSync(candidate) || statSync(candidate).isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentTypes[extname(candidate)] ?? 'application/octet-stream'
  })
  createReadStream(candidate).pipe(response)
})

server.listen(port, host, () => {
  process.stdout.write(`One Works Brand Studio: http://${host}:${port}/\n`)
})
