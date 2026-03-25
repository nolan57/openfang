# Self-Evolution Visualization Dashboard

## Overview

The Self-Evolution Visualization System provides a web interface for real-time viewing and browsing of all historical records,achievement content, and system state of the OpenCode self-evolution process.

## Features

### 📊 Statistics Overview

- Total run count
- Total knowledge items
- Data source distribution
- Recent run records

### 📈 Data Visualization

- **Source Distribution Chart**: Pie chart showing proportions of search/arxiv/github/pypi/blog sources
- **Action Type Chart**: Bar chart showing distribution of note_only/install_skill/code_suggestion action types

### 📜 Run History

- Detailed list of all evolution runs
- Trigger method (cron/idle/manual)
- Run status (running/completed/failed)
- Number of collected data items
- Timestamp records

### 📚 Learning Notes

- Learning notes grouped by run
- Markdown format note content
- Note index browsing
- Source link tracking

### 💾 System Snapshots

- System state backups before evolution
- Rollback snapshot management
- Golden snapshot marking
- Timeline browsing

## API Endpoints

### Base URL

```
http://localhost:4096/api/evolution
```

### Endpoint List

| Endpoint                  | Method | Description                                      |
| ------------------------- | ------ | ------------------------------------------------ |
| `/runs`                   | GET    | Get all evolution run records (latest 50)        |
| `/runs/:runId`            | GET    | Get detailed information and knowledge items for a single run |
| `/stats`                  | GET    | Get statistics (totals, distribution, recent runs) |
| `/snapshots`              | GET    | Get system snapshot list (latest 20)             |
| `/notes`                  | GET    | Get note file list and metadata                  |
| `/notes/:runId/:noteName` | GET    | Read complete content of a single note           |
| `/notes/:runId/index`     | GET    | Read note index for a run                        |

### API Response Examples

#### GET /stats

```json
{
  "success": true,
  "data": {
    "totalRuns": 15,
    "totalKnowledge": 135,
    "bySource": [
      {"source": "search", "count": 45},
      {"source": "arxiv", "count": 45},
      {"source": "github", "count": 45}
    ],
    "byAction": [
      {"action": "note_only", "count": 100},
      {"action": "install_skill", "count": 35}
    ],
    "recentRuns": [...]
  }
}
```

#### GET /runs/:runId

```json
{
  "success": true,
  "data": {
    "id": "3d5a331a-382f-49a9-8bb1-81b14cc8aa38",
    "trigger": "manual",
    "status": "completed",
    "topics": ["AI", "code generation", "agent systems"],
    "items_collected": 9,
    "notes_created": 9,
    "time_created": 1774400000000,
    "items": [
      {
        "id": "...",
        "source": "search",
        "url": "https://...",
        "title": "Artificial Intelligence Index Report 2025",
        "summary": "...",
        "tags": ["AI", "report", "2025"],
        "value_score": 85,
        "action": "note_only"
      }
    ]
  }
}
```

## Usage

### 1. Start the Server

```bash
cd packages/opencode
bun run src/index.ts serve
```

### 2. Access Dashboard

Open browser and visit:

```
http://localhost:4096/api/evolution/static/evolution-dashboard.html
```

Or use a static file server:

```bash
# Use any HTTP server
npx serve packages/opencode/src/server/static
```

### 3. View Specific Run

```bash
# View run details
curl http://localhost:4096/api/evolution/runs/3d5a331a-382f-49a9-8bb1-81b14cc8aa38

# View statistics
curl http://localhost:4096/api/evolution/stats

# View notes list
curl http://localhost:4096/api/evolution/notes
```

### 4. Read Notes

Note files are stored at:

```
~/docs/learning/notes/{runId}/
```

Each run contains:

- `index.md` - Index and statistics for this run
- `{noteName}.md` - Individual learning notes (Markdown format)

## Data Storage

### Database Tables

#### learning_run

Stores evolution run records:

- `id`: Run ID (UUID)
- `trigger`: Trigger method (cron/idle/manual)
- `status`: Run status (running/completed/failed)
- `topics`: Research directions (JSON array)
- `items_collected`: Number of collected items
- `notes_created`: Number of notes created

#### knowledge

Stores knowledge items:

- `id`: Knowledge ID (UUID)
- `run_id`: Associated run ID
- `source`: Source (search/arxiv/github/pypi/blog)
- `url`: Original URL
- `title`: Title
- `summary`: Summary
- `tags`: Tags (JSON array)
- `value_score`: Value score (0-100)
- `action`: Action type (note_only/install_skill/code_suggestion)

#### archive_snapshot

Stores system snapshots:

- `id`: Snapshot ID (UUID)
- `snapshot_type`: Type (pre_evolution/golden, etc.)
- `description`: Description
- `state`: Serialized state (JSON)
- `checksum`: SHA256 checksum
- `is_golden`: Whether it's a golden snapshot

### File System

Notes are stored at:

```
~/docs/learning/notes/
├── {runId-1}/
│   ├── index.md
│   ├── Note_Title_1.md
│   └── Note_Title_2.md
├── {runId-2}/
│   └── ...
```

## Visualization Components

Dashboard uses the following technologies:

- **TailwindCSS**: Responsive UI framework
- **Chart.js**: Data visualization charts
- **Native JavaScript**: No build dependencies

## Security Considerations

1. **Local Access**: Dashboard only runs on localhost:4096 by default
2. **Authentication**: If `OPENCODE_SERVER_PASSWORD` is set, authentication is required
3. **CORS**: Cross-origin access must be allowed in server configuration

## Extension Development

### Add New Visualization Components

1. Add a new card in HTML:

```html
<div class="card p-6">
  <h3 class="text-xl font-bold mb-4">New Component Title</h3>
  <div id="newComponent"></div>
</div>
```

2. Add data loading in JavaScript:

```javascript
const res = await fetch(`${API_BASE}/new-endpoint`);
const data = await res.json();
document.getElementById('newComponent').innerHTML = ...;
```

3. Add API endpoint in `evolution.ts`:

```typescript
app.get("/new-endpoint", async (c) => {
  // Implement logic
})
```

## Troubleshooting

### Dashboard Cannot Load

- Confirm server is running: `bun run src/index.ts serve`
- Check if port is occupied: `lsof -i :4096`
- Verify API is accessible: `curl http://localhost:4096/api/evolution/stats`

### Data Shows Empty

- Run evolution command to generate data: `/evolve`
- Check database: `sqlite3 ~/.local/share/opencode/opencode.db "SELECT COUNT(*) FROM knowledge;"`
- Verify notes directory: `ls ~/docs/learning/notes/`

### CORS Issues

If encountering CORS errors, add on server startup:

```typescript
app.use("*", cors({ origin: "*" }))
```

## Performance Optimization Suggestions

1. **Pagination**: Add pagination support for large data volumes
2. **Caching**: Cache statistics on browser side
3. **Lazy Loading**: Load note content on demand
4. **WebSocket**: Real-time evolution status updates (future feature)

## Future Feature Planning

- [ ] Real-time evolution progress monitoring
- [ ] Knowledge graph visualization
- [ ] Timeline view
- [ ] Export functionality (PDF/Markdown)
- [ ] Search and filtering
- [ ] Compare different runs
- [ ] Skills and code suggestion management interface
- [ ] Mobile adaptation

## Related Documentation

- [Self-Evolving Agent Architecture](./docs/SELF_EVOLVING_AGENT.md)
- [Learning System Configuration](./docs/learning/README.md)
- [Complete API Documentation](../sdk/openapi.json)
