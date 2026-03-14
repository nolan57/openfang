import "@/index.css"
import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { ErrorBoundary } from "solid-js"
import { XRayLayout, XRayLivePage, XRayTracePage, XRayServicesPage } from "./pages/xray"
import { ErrorPage } from "./pages/error"

// Simple i18n provider for XRay
const i18nValue = {
  locale: () => "en",
  t: (key: string) => key,
}

function XRayApp() {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <I18nProvider value={i18nValue}>
          <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
            <DialogProvider>
              <Router base="/xray">
                <Route path="/" component={XRayLayout}>
                  <Route path="/" component={XRayLivePage} />
                  <Route path="/live" component={XRayLivePage} />
                  <Route path="/trace/:id" component={XRayTracePage} />
                  <Route path="/services" component={XRayServicesPage} />
                </Route>
              </Router>
            </DialogProvider>
          </ErrorBoundary>
        </I18nProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

const root = document.getElementById("root")
if (root) {
  render(() => <XRayApp />, root)
}
