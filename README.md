# TryVidimusMCP

Source of the [tryVidimus](https://tryvidimus.com) MCP server, published on npm as [`@tryvidimus/mcp`](https://www.npmjs.com/package/@tryvidimus/mcp).

[Model Context Protocol](https://modelcontextprotocol.io) server: it lets an AI assistant open captures, list and read proofs, get a signed copy link, and verify a proof
without trusting our servers. It talks to the public tryVidimus API (`https://api.tryvidimus.com`) with your API key, over standard input and output (`stdio`).

```sh
claude mcp add tryvidimus -e TRYVIDIMUS_API_KEY=sk_test_… -- npx -y @tryvidimus/mcp
```

Use a **sandbox key** (`sk_test_…`). A production key is refused unless `TRYVIDIMUS_MCP_ALLOW_LIVE=true` is set. See [PACKAGE_README.md](PACKAGE_README.md) for the tools and the
security notes.

> This repository is an **export** of code maintained in our own repository: it is published so you can read it and check what you install. Pull requests cannot be merged
> here directly; open an issue to discuss a change.

## Develop

```
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm build:npm      # writes the npm package to dist-npm/
```

Node 22 or later. The server has **no runtime dependency**: the npm package is one file that contains everything (`THIRD_PARTY_LICENSES.md` lists the licenses of the code it
embeds). The API client and the verifier come from [`@tryvidimus/api-client`](https://www.npmjs.com/package/@tryvidimus/api-client) and
[`@tryvidimus/verifier`](https://www.npmjs.com/package/@tryvidimus/verifier) (the verifier source is at [TryVidimusVerify](https://github.com/fyher/TryVidimusVerify)).

## Security

Please report vulnerabilities **privately** through GitHub (Security tab, "Report a vulnerability"), not in a public issue. See [SECURITY.md](SECURITY.md).

## License

MIT, Copyright (c) 2026 Fyher.
