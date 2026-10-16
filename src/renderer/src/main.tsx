import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import OutputApp from './OutputApp'
import { useSceneStore } from './state/sceneStore'
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import './styles/global.css'

// Lets CSS make room for the macOS traffic lights inset into the top bar.
if (navigator.userAgent.includes('Mac')) document.documentElement.dataset.platform = 'mac'

// The same renderer bundle serves both windows: the control window (default)
// and the fullscreen output window, which loads this file with a
// "#/output" (or "#output") hash so it renders a display-only view with no
// editing chrome.
const route = window.location.hash.replace('#', '').replace(/^\//, '')
const isOutputWindow = route === 'output'

/**
 * Restore the autosaved surfaces before the first render, so the editor
 * never flashes the default scene (and never syncs it to the projector or
 * autosaves it over the real one). A failed load just starts fresh.
 */
async function restoreScene(): Promise<void> {
  try {
    const saved = await window.mirrorcat.loadSavedScene()
    if (saved) useSceneStore.getState().hydrate(saved)
  } catch (error) {
    console.error('[autosave] restore failed', error)
  }
}

async function boot(): Promise<void> {
  if (!isOutputWindow) await restoreScene()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>{isOutputWindow ? <OutputApp /> : <App />}</React.StrictMode>
  )
}

void boot()
