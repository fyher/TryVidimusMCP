# The tryVidimus MCP server as a container (stdio). Run it with:
#   docker run -i --rm -e TRYVIDIMUS_API_KEY=sk_test_... <image>
# The key is never baked into the image: it is passed at run time.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build:npm

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /app
# Same layout as the npm package: the server reads ../package.json next to dist/.
COPY --from=build /app/dist-npm ./
USER node
ENTRYPOINT ["node", "/app/dist/tryvidimus-mcp.mjs"]
