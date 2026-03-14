# Observability (X-Ray Mode)

## Critical Configuration

- **OTEL env vars alone are NOT sufficient for AI SDK traces.** You must also set `experimental.openTelemetry: true` in `opencode.json`:
  ```json
  { "experimental": { "openTelemetry": true } }
  ```
- This flag controls `experimental_telemetry.isEnabled` in `src/agent/agent.ts` for AI SDK calls (streamText, generateText).
- Without this flag, no spans are created for AI operations even with OTEL_ENABLED=true.

## Initialization Flow

1. `src/index.ts` middleware calls `initObservability()` during CLI startup.
2. `init.ts` creates `NodeSDK` with `BatchSpanProcessor` and `OTLPTraceExporter`.
3. Spans are batched and exported every 5s (scheduledDelayMillis) or when queue reaches 512 items.

## Environment Variables

- `OTEL_ENABLED` - Master switch (default: true)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - Collector URL (default: `http://localhost:4318/v1/traces`)
- `OTEL_SAMPLE_RATE` - Sampling rate (dev: 1.0, prod: 0.01)
- `OTEL_DEBUG=true` - Enable verbose OpenTelemetry diagnostics
