import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('root element not found: index.html must contain <div id="root">')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
