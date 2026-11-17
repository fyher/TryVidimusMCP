# The tryVidimus MCP server as a container (stdio). Run it with:
#   docker run -i --rm -e TRYVIDIMUS_API_KEY=sk_test_... <image>
# The key is never baked into the image: it is passed at run time.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build:npm

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
# Same layout as the npm package: the server reads ../package.json next to dist/.
COPY --from=build /app/dist-npm ./
USER node
ENTRYPOINT ["node", "/app/dist/tryvidimus-mcp.mjs"]
