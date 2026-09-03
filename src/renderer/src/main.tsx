import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import OutputApp from './OutputApp'
import './styles/global.css'

// The same renderer bundle serves both windows: the control window (default)
// and the fullscreen output window, which loads this file with a
// "#/output" (or "#output") hash so it renders a display-only view with no
// editing chrome.
const route = window.location.hash.replace('#', '').replace(/^\//, '')
const isOutputWindow = route === 'output'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{isOutputWindow ? <OutputApp /> : <App />}</React.StrictMode>
)
