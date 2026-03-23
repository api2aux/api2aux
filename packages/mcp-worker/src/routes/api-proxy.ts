import { Hono } from 'hono'
import { proxyRequest, handleCorsPreflightResponse } from '@api2aux/cors-proxy'

const apiProxy = new Hono()

apiProxy.all('/api-proxy/*', async (c) => {
  if (c.req.method === 'OPTIONS') {
    return handleCorsPreflightResponse()
  }

  const encodedTarget = c.req.path.replace('/api-proxy/', '')
  const targetUrl = decodeURIComponent(encodedTarget)

  if (!targetUrl.startsWith('http')) {
    return c.text('Missing or invalid target URL', 400)
  }

  try {
    return await proxyRequest(c.req.raw, targetUrl)
  } catch (err) {
    return c.text(`Proxy error: ${err instanceof Error ? err.message : 'unknown'}`, 502)
  }
})

export { apiProxy }
