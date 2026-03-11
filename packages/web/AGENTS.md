# OpenCode Web Documentation Site

This is the documentation website for OpenCode, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It supports 17 languages with a sophisticated i18n system and session sharing capabilities.

## Project Overview

- **Framework**: Astro 5.x with Starlight documentation theme
- **UI Components**: SolidJS for interactive components
- **Deployment**: Cloudflare (server-side rendering)
- **Base URL**: `/docs` (configured in `astro.config.mjs`)

## Commands

```bash
# Development
bun dev                 # Start dev server at localhost:4321
bun dev:remote          # Dev with remote API (VITE_API_URL=https://api.opencode.ai)

# Build & Preview
bun build               # Build production site to ./dist/
bun preview             # Preview build locally

# Type checking
bun astro check         # Run Astro type checking
```

## Project Structure

```
src/
├── assets/              # Static images (logos, screenshots)
│   ├── lander/          # Homepage landing page images
│   └── web/             # Web app screenshots
├── components/          # Astro & SolidJS components
│   ├── Hero.astro       # Hero section (conditional Lander or default)
│   ├── Lander.astro     # Custom landing page with installation commands
│   ├── Share.tsx        # Session sharing component (SolidJS)
│   ├── Head.astro       # Custom head for OG images
│   └── share/           # Share feature sub-components
├── content/
│   ├── docs/            # Documentation pages (MDX)
│   │   ├── index.mdx    # English docs (root locale)
│   │   └── {locale}/    # Translated docs (zh-cn, ja, de, etc.)
│   └── i18n/            # UI translations (JSON)
├── i18n/
│   └── locales.ts       # Locale configuration and matching logic
├── pages/
│   ├── [...slug].md.ts  # API endpoint for raw markdown content
│   └── s/[id].astro     # Share page (/s/{session-id})
├── middleware.ts        # Locale detection and redirects
└── styles/
    └── custom.css       # Global CSS overrides
```

## Internationalization (i18n)

### Supported Locales

17 languages supported (configured in `astro.config.mjs`):

| Code | Language |
|------|----------|
| root | English (default) |
| ar | Arabic (RTL) |
| zh-cn | Simplified Chinese |
| zh-tw | Traditional Chinese |
| ja | Japanese |
| ko | Korean |
| de | German |
| es | Spanish |
| fr | French |
| it | Italian |
| pt-br | Brazilian Portuguese |
| ru | Russian |
| tr | Turkish |
| th | Thai |
| pl | Polish |
| da | Danish |
| nb | Norwegian Bokmål |
| bs | Bosnian |

### Adding/Updating Translations

1. **UI Strings**: Edit `src/content/i18n/{locale}.json`
2. **Documentation**: Create/edit `src/content/docs/{locale}/{page}.mdx`

### Locale Detection Flow

Implemented in `src/middleware.ts`:

1. Check `oc_locale` cookie
2. Parse `Accept-Language` header
3. Redirect to appropriate locale path

## Key Features

### Landing Page (`src/components/Lander.astro`)

- Custom hero section with installation commands
- Copy-to-clipboard functionality for install commands
- Multiple installation methods (npm, bun, homebrew, paru, mise)
- Responsive grid layout with screenshots

### Session Sharing (`src/pages/s/[id].astro` + `src/components/Share.tsx`)

- WebSocket-based real-time session updates
- Displays conversation messages with tool calls
- Shows token usage and cost statistics
- OpenGraph image generation via `config.socialCard`

### Configuration Schema Generation

During build, runs `../opencode/script/schema.ts` to generate `./dist/config.json`.

## Configuration Files

| File | Purpose |
|------|---------|
| `astro.config.mjs` | Astro + Starlight configuration, i18n setup, sidebar |
| `config.mjs` | Environment-specific URLs (stage-based) |
| `src/content.config.ts` | Content collections schema |
| `src/i18n/locales.ts` | Locale codes and matching functions |

## Styling

- Uses Starlight's default styling with custom overrides in `src/styles/custom.css`
- CSS variables for light/dark mode theming
- Expressive Code for syntax highlighting

## Dependencies

Key packages:

- `@astrojs/starlight` - Documentation theme
- `@astrojs/solid-js` - SolidJS integration
- `@astrojs/cloudflare` - Cloudflare adapter
- `solid-js` - UI components
- `luxon` - Date/time formatting
- `lang-map` - Language code mapping
- `toolbeam-docs-theme` - Additional theme plugins

## Development Notes

- The `opencode` workspace package is used for TypeScript types (`Session.Info`, `MessageV2.Part`, etc.)
- Static assets go in `public/`
- Images referenced in MDX should be in `src/assets/`
- The sidebar structure is defined in `astro.config.mjs` with translation support
- Social card images are generated dynamically via `config.socialCard` URL
