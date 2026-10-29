import { createRoot } from 'react-dom/client'
import { CompanionApp } from './App'
import '../src/styles/tokens.css'
import './companion.css'

createRoot(document.getElementById('root')!).render(<CompanionApp />)
