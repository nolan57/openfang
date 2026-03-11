# @opencode-ai/ui

Shared UI component library for OpenCode, built with SolidJS and Kobalte.

## Overview

This package provides a comprehensive set of reusable UI components, themes, and utilities used across the OpenCode application ecosystem. It follows a CSS-first styling approach with CSS custom properties for theming.

**Key Technologies:**
- **SolidJS** - Reactive UI framework
- **Kobalte** - Headless UI component primitives
- **Tailwind CSS v4** - Utility-first CSS framework
- **Vite** - Build tool and dev server
- **Shiki** - Syntax highlighting
- **Marked** - Markdown parsing

## Project Structure

```
src/
├── components/       # UI components (Button, Dialog, Markdown, etc.)
│   ├── *.tsx         # Component implementation
│   ├── *.css         # Component styles
│   ├── app-icons/    # Application icons (generated)
│   ├── file-icons/   # File type icons (generated)
│   └── provider-icons/ # AI provider icons (fetched from models.dev)
├── context/          # SolidJS context providers
│   ├── i18n.tsx      # Internationalization
│   ├── diff.tsx      # Diff rendering context
│   ├── dialog.tsx    # Dialog management
│   └── marked.tsx    # Markdown parser setup
├── hooks/            # Reusable SolidJS hooks
│   ├── use-filtered-list.tsx
│   └── create-auto-scroll.tsx
├── i18n/             # Language dictionaries (ar, br, de, en, zh, etc.)
├── pierre/           # Diff rendering integration (@pierre/diffs)
├── styles/           # Global styles and Tailwind config
│   ├── index.css     # Main style entry
│   ├── base.css      # Base/reset styles
│   ├── colors.css    # Color tokens
│   ├── theme.css     # Theme CSS variables
│   └── tailwind/     # Tailwind-specific styles
├── theme/            # Theme system
│   ├── types.ts      # Theme type definitions
│   ├── color.ts      # Color conversion utilities
│   ├── resolve.ts    # Theme resolution logic
│   ├── loader.ts     # Theme loading/apply functions
│   ├── context.tsx   # Theme provider component
│   └── default-themes.ts # Built-in theme presets
└── assets/           # Static assets
    ├── audio/        # Sound effects (alerts, notifications)
    ├── fonts/        # Custom fonts
    └── icons/        # SVG icon sources
```

## Commands

```bash
# Development
bun dev                  # Start Vite dev server (port 3001)

# Type Checking
bun typecheck            # Run TypeScript type check (uses tsgo)

# Generate
bun generate:tailwind    # Generate Tailwind color variables
```

## Component Architecture

### Component Pattern

Components follow a consistent pattern using Kobalte primitives:

```tsx
import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, splitProps } from "solid-js"

export interface ButtonProps extends ComponentProps<typeof Kobalte> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
}

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["size", "variant", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={local.size || "normal"}
      data-variant={local.variant || "secondary"}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}
```

**Key conventions:**
- Use `data-component` attribute for component identification
- Use `data-*` attributes for variants/size modifiers (enables CSS selectors)
- Use `splitProps` to separate local props from forwarded props
- Always provide CSS via `class`/`classList` props, not inline styles

### Styling Pattern

Each component has a paired CSS file with BEM-like selectors:

```css
[data-component="button"] {
  /* base styles */
}

[data-component="button"][data-size="small"] {
  /* size variant */
}

[data-component="button"][data-variant="primary"] {
  /* color variant */
}
```

## Theme System

### Theme Structure

Themes are defined using seed colors that generate full color scales:

```ts
interface ThemeSeedColors {
  neutral: HexColor    // Base gray scale
  primary: HexColor    // Primary accent
  success: HexColor    // Success states
  warning: HexColor    // Warning states
  error: HexColor      // Error states
  info: HexColor       // Info states
  interactive: HexColor // Interactive elements
  diffAdd: HexColor    // Diff additions
  diffDelete: HexColor // Diff deletions
}
```

### Using Themes

```tsx
import { ThemeProvider, useTheme } from "@opencode-ai/ui/theme"

function App() {
  return (
    <ThemeProvider>
      <Child />
    </ThemeProvider>
  )
}

function Child() {
  const { theme, setColorScheme } = useTheme()
  // ...
}
```

### Built-in Themes

- `oc1Theme`, `oc2Theme` - OpenCode defaults
- `tokyonightTheme`, `draculaTheme`, `monokaiTheme`
- `solarizedTheme`, `nordTheme`, `catppuccinTheme`
- `ayuTheme`, `oneDarkProTheme`, `vesperTheme`

## Internationalization

### Usage

```tsx
import { I18nProvider, useI18n } from "@opencode-ai/ui/context"

function App() {
  return (
    <I18nProvider locale="zh">
      <Child />
    </I18nProvider>
  )
}

function Child() {
  const { t, locale, setLocale } = useI18n()
  return <span>{t("ui.common.cancel")}</span>
}
```

### Adding Translations

Add keys to language files in `src/i18n/*.ts`:

```ts
// src/i18n/zh.ts
export const dict = {
  "ui.common.cancel": "取消",
  // ...
}
```

## Exports

```ts
// Components
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Markdown } from "@opencode-ai/ui/markdown"

// Theme
import { ThemeProvider, useTheme } from "@opencode-ai/ui/theme"
import { DEFAULT_THEMES } from "@opencode-ai/ui/theme"

// Context
import { I18nProvider, useI18n } from "@opencode-ai/ui/context"

// Hooks
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { createAutoScroll } from "@opencode-ai/ui/hooks"

// Styles
import "@opencode-ai/ui/styles"         // Full stylesheet
import "@opencode-ai/ui/styles/tailwind" // Tailwind utilities

// Icons (generated types)
import type { ProviderIcon } from "@opencode-ai/ui/icons/provider"
import type { FileIcon } from "@opencode-ai/ui/icons/file-type"
```

## Icon Generation

Icons are auto-generated during build:

1. **File type icons** - From `src/assets/icons/file-types/` via `vite-plugin-icons-spritesheet`
2. **Provider icons** - Fetched from `https://models.dev/logos/` at build time
3. **App icons** - Generated from `src/assets/icons/`

## Diff Rendering

The `pierre` module provides diff rendering using `@pierre/diffs`:

```tsx
import { Diff, createDefaultOptions } from "@opencode-ai/ui/pierre"

<Diff
  before={oldContent}
  after={newContent}
  diffStyle="unified" // or "split"
/>
```

## CSS Architecture

Styles use CSS layers for proper cascade:

```css
@layer theme, base, components, utilities;
```

1. **theme** - CSS variables and color tokens
2. **base** - Reset and base element styles
3. **components** - Component-specific styles
4. **utilities** - Utility classes and animations

## Dependencies

### Core
- `solid-js` - Reactive framework
- `@kobalte/core` - Headless UI primitives

### Content Rendering
- `marked` - Markdown parsing
- `shiki` - Syntax highlighting
- `katex` - Math rendering

### Diff
- `@pierre/diffs` - Diff rendering engine

### Utilities
- `dompurify` - HTML sanitization
- `morphdom` - DOM diffing for updates
- `luxon` - Date/time handling
- `remeda` - Utility functions
