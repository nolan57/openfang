# Observability Deployment

## Jaeger UI Quirks

- Service dropdown + "Find Traces" button often shows empty results. Use URL parameters directly: `http://localhost:16686/search?service=opencode-agent&limit=20&lookback=1h`
- Jaeger API works correctly; this is a UI interaction bug, not a data issue.

## Architecture

- OTel collector exposes ports 4317/4318 to host machine.
- Collector forwards traces to Jaeger via internal Docker network: `http://jaeger:4318` (otlphttp exporter).
- Jaeger's OTLP receiver ports are internal-only; do not expose them in docker-compose.yml.
- Trace flow: `opencode → collector:4318 → jaeger:4318 (internal) → Jaeger UI:16686`

## Debugging

- Check traces via API: `curl "http://localhost:16686/api/traces?service=opencode-agent&limit=5" | jq .`
- Check collector metrics: `curl http://localhost:8888/metrics`
