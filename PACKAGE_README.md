# @tryvidimus/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [tryVidimus](https://tryvidimus.com): let an AI assistant open captures, list and read proofs, get a signed copy link, and verify a proof. One file, no dependencies to install.

With Claude Code:

```sh
claude mcp add tryvidimus -e TRYVIDIMUS_API_KEY=sk_test_… -- npx -y @tryvidimus/mcp
```

Use a **sandbox key** (`sk_test_…`) by default. A production key lets the assistant act on real data.

## Security

- The server sees **only the data of the organization your key belongs to**, never another customer's. Reading proofs needs the `read_proof` scope.
- `get_media_access_link` returns a link, valid for 15 minutes, to a signed copy of one of **your own** files. The link appears in the conversation: if that conversation is shared or stored elsewhere, anyone with the link can open the file during those 15 minutes. Keep your MCP client's confirmation prompt on for this tool.
- An assistant could be pushed to call it by text hidden in the data it reads (a reference, a step, a label). Those fields are written by **your platform**, not by the people who capture, so never copy text typed by a third party (a name, a message, a comment) into a reference, label or template name.
- Use a sandbox key (`sk_test_…`) unless you really want the assistant to act on production data; a production key is refused unless `TRYVIDIMUS_MCP_ALLOW_LIVE=true` is set.

Tools: `create_capture_session`, `list_proofs`, `get_proof`, `get_media_access_link`, `verify_proof`, `list_webhook_endpoints`. Requires Node.js 22 or later. MIT licensed.
