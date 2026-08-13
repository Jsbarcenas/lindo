# Build context is the repository root, not this directory: pnpm needs the
# workspace to resolve @lindo/* by symlink rather than by download.
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /repo

# The manifests first, so the install layer survives edits to source files.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/lindo-web/package.json apps/lindo-web/
COPY packages/host-web/package.json packages/host-web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/client-store/package.json packages/client-store/
COPY packages/theme/package.json packages/theme/
COPY packages/i18n/package.json packages/i18n/
COPY packages/mods/package.json packages/mods/
COPY packages/dofus-window/package.json packages/dofus-window/
COPY packages/updater-core/package.json packages/updater-core/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/desktop/package.json apps/desktop/
COPY apps/lindo-mobile/package.json apps/lindo-mobile/

# --ignore-scripts keeps the desktop postinstall from rebuilding Electron's
# native modules, which this image has no use for and which need a toolchain.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# Downloads the Dofus shell and applies regex.json, so the image ships a client
# that is patched at the version it was built against. Needs network at build
# time, which Railway provides.
RUN pnpm --filter lindo-web build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /repo/apps/lindo-web/dist ./dist
COPY --from=build /repo/apps/lindo-web/server.mjs ./server.mjs

# Railway injects PORT; the default matches so the image runs the same locally.
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server.mjs"]
