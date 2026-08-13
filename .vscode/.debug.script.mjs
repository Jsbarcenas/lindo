import { writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(__dirname, '../apps/desktop')
const pkg = createRequire(import.meta.url)('../apps/desktop/package.json')

// write .debug.env
const envContent = Object.entries(pkg.env).map(([key, val]) => `${key}=${val}`)
writeFileSync(path.join(__dirname, '.debug.env'), envContent.join('\n'))

// watch.mjs addresses its vite configs relative to the working directory, and
// VS Code starts tasks at the workspace root rather than inside the app
process.chdir(appDir)

// bootstrap
import('../apps/desktop/scripts/watch.mjs?debug=vscode')
