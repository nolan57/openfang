# 🚀 Self-Evolution Visualization Dashboard - Quick Start Guide

## Feature Highlights

### Real-time Data Visualization

- 📊 **Statistics Panel**: Total runs, knowledge items, source distribution
- 📈 **Dynamic Charts**: Pie chart for source distribution, bar chart for action types
- 📜 **History Log**: Detailed list of all evolution runs
- 📚 **Learning Notes**: Browse learning notes grouped by run
- 💾 **System Snapshots**: Manage state backups before and after evolution

### Technical Features

- ✨ **Responsive Design**: Adapts to desktop and mobile devices
- 🎨 **Beautiful UI**: Gradient cards, smooth animations
- ⚡ **Fast Loading**: Native JavaScript, no build dependencies
- 📡 **RESTful API**: Complete backend API support

## Quick Start

### Method 1: Using Launch Script (Recommended)

```bash
cd packages/opencode
./scripts/evolution-dashboard.sh
```

### Method 2: Manual Start

1. **Start the Server**

```bash
cd packages/opencode
bun run src/index.ts serve
```

2. **Open Browser**

```
http://localhost:4096/api/evolution/static/evolution-dashboard.html
```

### Method 3: Direct Static File Access

```bash
# Use any static file server
npx serve src/server/static

# Then access
http://localhost:3000/evolution-dashboard.html
```

## Usage Examples

### View Statistics

The Dashboard will automatically load and display:

- Total run count
- Total knowledge items
- Data source distribution
- Action type distribution

### Browse Run History

1. View recent runs in the "Recent Evolution Runs" table
2. Click "View Details" to see complete run data in a new window
3. View detailed information in JSON format, including all knowledge items

### Read Learning Notes

1. View recent note groups in the "Learning Notes" section
2. Click any note group to view the index for that run
3. Access specific learning note content through the index

### View System Snapshots

View in the "System Snapshots" section:

- Snapshot type (pre_evolution/golden)
- Snapshot description
- Creation time
- Snapshot ID for rollback

## API Usage Examples

### Get Statistics

```bash
curl http://localhost:4096/api/evolution/stats | jq
```

**Response Example**:

```json
{
  "success": true,
  "data": {
    "totalRuns": 15,
    "totalKnowledge": 135,
    "bySource": [
      { "source": "search", "count": 45 },
      { "source": "arxiv", "count": 45 },
      { "source": "github", "count": 45 }
    ],
    "byAction": [
      { "action": "note_only", "count": 100 },
      { "action": "install_skill", "count": 35 }
    ]
  }
}
```

### Get Run List

```bash
curl http://localhost:4096/api/evolution/runs | jq '.data[0]'
```

### Get Specific Run Details

```bash
curl http://localhost:4096/api/evolution/runs/{runId} | jq
```

### Get Notes List

```bash
curl http://localhost:4096/api/evolution/notes | jq
```

### Read Note Content

```bash
curl http://localhost:4096/api/evolution/notes/{runId}/{noteName} | jq '.data.content'
```

## Customizing the Dashboard

### Modify Color Theme

Edit CSS in `evolution-dashboard.html`:

```css
/* Modify gradient colors */
.gradient-header {
  background: linear-gradient(135deg, #your-color 0%, #your-color 100%);
}
```

### Add New Charts

Add a new canvas in HTML:

```html
<canvas id="myChart"></canvas>
```

Add Chart.js configuration in JavaScript:

```javascript
const ctx = document.getElementById('myChart').getContext('2d');
new Chart(ctx, {
  type: 'line', // or 'bar', 'pie', 'doughnut'
  data: { ... },
  options: { ... }
});
```

### Add New Data Cards

```html
<div class="card p-6">
  <h3 class="text-xl font-bold mb-4">New Panel Title</h3>
  <div id="newPanel"></div>
</div>
```

Then populate data in JavaScript:

```javascript
async function loadMyData() {
  const res = await fetch(`${API_BASE}/my-endpoint`);
  const data = await res.json();
  document.getElementById('newPanel').innerHTML = ...;
}
```

## Frequently Asked Questions

### Q: Dashboard shows blank page

**A**:

1. Confirm server is running: `curl http://localhost:4096/api/evolution/stats`
2. Check browser console for errors
3. Ensure port 4096 is not occupied

### Q: No data displayed

**A**:

1. Run evolution command to generate data: `/evolve`
2. Check if database has data
3. Check if note directory has files

### Q: How to view raw data

**A**:

- Click "View Details" in the runs table
- Or access API endpoints directly (see API examples above)
- Or query database: `sqlite3 ~/.local/share/opencode/opencode.db`

### Q: Can I access remotely

**A**:
By default, only local access is allowed. For remote access:

1. Bind to 0.0.0.0 on startup
2. Configure firewall rules
3. Set authentication password

### Q: How long is data retained

**A**:

- Database data: Permanently, unless manually deleted
- Note files: Permanently, stored in ~/docs/learning/notes/
- System snapshots: Keep the most recent 20

## Performance Optimization

### Speed Up Loading

1. Reduce data volume per load (modify API limit parameter)
2. Enable browser caching
3. Use CDN for TailwindCSS and Chart.js

### Handle Large Data Volumes

If run count exceeds 100:

1. Add pagination support in API
2. Implement lazy loading
3. Add search and filtering functionality

## Data Export

### Export as JSON

```bash
# Export all run records
curl http://localhost:4096/api/evolution/runs > runs.json

# Export statistics
curl http://localhost:4096/api/evolution/stats > stats.json

# Export all notes metadata
curl http://localhost:4096/api/evolution/notes > notes.json
```

### Export Notes as Markdown

Note files are already stored in Markdown format at:

```
~/docs/learning/notes/{runId}/{noteName}.md
```

Can copy directly or batch export:

```bash
cp -r ~/docs/learning/notes/ ~/backup/evolution-notes/
```

## Integration into Other Projects

### Embed into Existing Web Pages

Use iframe:

```html
<iframe
  src="http://localhost:4096/api/evolution/static/evolution-dashboard.html"
  width="100%"
  height="800px"
  frameborder="0"
></iframe>
```

### Use as Component

Copy HTML and JavaScript code into your project, modify API_BASE to point to your server.

### API Client Library

Can use any HTTP client library to access API:

**Python Example**:

```python
import requests

response = requests.get('http://localhost:4096/api/evolution/stats')
data = response.json()['data']
print(f"Total runs: {data['totalRuns']}")
```

**JavaScript Example**:

```javascript
const response = await fetch("http://localhost:4096/api/evolution/stats")
const data = await response.json()
console.log(`Total runs: ${data.data.totalRuns}`)
```

## Development Roadmap

- [ ] Real-time WebSocket push for evolution progress
- [ ] Knowledge graph visualization (D3.js)
- [ ] Timeline view
- [ ] Export data to PDF
- [ ] Advanced search and filtering
- [ ] Compare different runs
- [ ] Skill and code suggestion management
- [ ] Mobile optimization
- [ ] Dark mode
- [ ] Multi-language support

## Technical Support

- 📖 [Full Documentation](./docs/evolution-dashboard.md)
- 💬 [Self-Evolving Agent System](./docs/SELF_EVOLVING_AGENT.md)
- 🔧 [API Documentation](../sdk/openapi.json)
- 🐛 Having issues? Check server logs or submit an issue

---

**Happy Evolving! 🚀**
