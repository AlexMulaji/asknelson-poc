import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { GetHelpProvider } from './components/GetHelp.jsx'
import { AuthProvider } from './hooks/useAuth.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import { initAnalytics } from './lib/analytics.js'
import './index.css'

// Start tracking before the first render so the WhatsApp ?t= token is captured
// (and stripped from the URL) ahead of anything that reads the query string.
// The admin console is staff-facing, so it is deliberately not tracked.
if (!window.location.pathname.startsWith('/admin')) {
  initAnalytics()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          {/* Wraps the whole of App, not just the member shell, so Get Help
              can be raised from every screen -- signed-out auth pages too. */}
          <GetHelpProvider>
            <App />
          </GetHelpProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
