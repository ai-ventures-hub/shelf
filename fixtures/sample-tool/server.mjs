import http from 'node:http'

/**
 * Tiny fixture web tool for Shelf launch/stop smoke tests.
 * Listens on PORT (default 8765) and prints a ready line for log visibility.
 */
const port = Number(process.env.PORT || 8765)

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Shelf sample tool is running\n')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Sample tool listening on http://127.0.0.1:${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
