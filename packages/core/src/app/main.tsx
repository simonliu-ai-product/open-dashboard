import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'
import './styles/batch-a.css'
import './styles/batch-b.css'
import './styles/batch-c.css'
import './styles/batch-d.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
