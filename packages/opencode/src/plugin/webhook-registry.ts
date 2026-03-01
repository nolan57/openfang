import { createHmac } from "crypto"

export type WebhookHandler = (req: Request) => Promise<Response>

export interface PluginWebhookRoute {
  path: string
  handler: WebhookHandler
  pluginId: string
  secret?: string
}

const pluginRoutes = new Map<string, PluginWebhookRoute>()

export function registerWebhookRoute(route: PluginWebhookRoute): () => void {
  if (pluginRoutes.has(route.path)) {
    console.warn(
      `[webhook-registry] Path ${route.path} already registered by ${pluginRoutes.get(route.path)?.pluginId}`,
    )
    return () => {}
  }
  pluginRoutes.set(route.path, route)
  console.log(`[webhook-registry] Registered ${route.path} for plugin ${route.pluginId}`)
  return () => {
    pluginRoutes.delete(route.path)
    console.log(`[webhook-registry] Unregistered ${route.path}`)
  }
}

export function resolveWebhookRoute(path: string): PluginWebhookRoute | undefined {
  return pluginRoutes.get(path)
}

export function getAllWebhookRoutes(): PluginWebhookRoute[] {
  return [...pluginRoutes.values()]
}

export function clearAllWebhookRoutes(): void {
  pluginRoutes.clear()
}

export function verifySignature(body: string, signature: string, secret: string): boolean {
  const hmac = createHmac("sha256", secret)
  const expected = hmac.update(body).digest("hex")
  return signature === expected
}
