import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [
    desktopPlugin,
    // Custom middleware to handle /xray SPA routing
    {
      name: "xray-spa-middleware",
      configureServer(server) {
        // Use return to add middleware before Vite's internal middleware
        return () => {
          server.middlewares.use((req, res, next) => {
            if (req.url === "/xray" || req.url?.startsWith("/xray/")) {
              req.url = "/xray.html"
            }
            next()
          })
        }
      },
    },
  ] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:4096",
        changeOrigin: true,
        // Disable buffering for SSE support
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.url?.includes("/stream")) {
              proxyReq.setHeader("Accept", "text/event-stream")
              proxyReq.setHeader("Cache-Control", "no-cache")
              proxyReq.setHeader("Connection", "keep-alive")
            }
          })
          proxy.on("proxyRes", (proxyRes, req, res) => {
            if (req.url?.includes("/stream")) {
              proxyRes.headers["cache-control"] = "no-cache"
              proxyRes.headers["connection"] = "keep-alive"
              proxyRes.headers["x-accel-buffering"] = "no"
            }
          })
        },
      },
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: "./index.html",
        xray: "./xray.html",
      },
    },
  },
})
