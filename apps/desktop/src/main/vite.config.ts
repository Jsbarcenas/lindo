import { builtinModules } from 'module'
import { defineConfig } from 'vite'
import pkg from '../../package.json'

/**
 * Everything not listed here stays external and is resolved from the
 * node_modules electron-builder copies into the asar, which is why anything
 * external must live in `dependencies` rather than `devDependencies`.
 * scripts/verify-asar.mjs enforces that the two agree.
 *
 * js-beautify is bundled because it drags in glob -> jackspeak -> @isaacs/cliui,
 * whose dependencies are declared as npm aliases ("string-width-cjs":
 * "npm:string-width@^4"), which electron-builder cannot resolve under pnpm - it
 * leaves them out of the asar. Only js-beautify's CLI touches that subtree, but
 * bundling the library keeps the asar complete instead of relying on the broken
 * part never being reached.
 *
 * get-port no longer has to be here now that this process is ESM, but bundling a
 * single-purpose helper costs nothing and keeps it out of the asar.
 */
const bundledModules = ['get-port', 'js-beautify']
const externalModules = Object.keys(pkg.dependencies || {}).filter((dep) => !bundledModules.includes(dep))

export default defineConfig({
  root: __dirname,
  build: {
    outDir: '../../dist/main',
    emptyOutDir: true,
    minify: process.env./* from mode option */ NODE_ENV === 'production',
    sourcemap: true,
    lib: {
      entry: 'index.ts',
      // .mjs rather than adding "type": "module" to the root package.json:
      // Electron accepts either, and the extension keeps every other .js in the
      // repo (scripts/afterPackHook.js, eslint config) CommonJS as it is today.
      formats: ['es'],
      fileName: () => '[name].mjs'
    },
    rollupOptions: {
      external: [
        'electron',
        'original-fs',
        ...builtinModules,
        // bundled dependencies import builtins through the node: prefix, which
        // does not match the bare names and would be stubbed out as browser code
        ...builtinModules.map((m) => `node:${m}`),
        ...externalModules
      ]
    }
  }
})
