# bridge server

a simple MCP server that lets two claude code agents talk to each other. one runs as "frontend", the other as "backend". they share tickets and messages through json files.

## what it does

- agents can create tickets to request things from each other
- they can send quick messages (fire and forget)
- a hook checks for new stuff before every prompt so the agent doesn't miss anything

## setup

```bash
npm install
```

then create the store files (first time only):

```bash
echo '{ "tickets": [] }' > store/tickets.json
echo '{ "messages": [] }' > store/messages.json
echo '{}' > store/delivery.json
```

add `.mcp.json` to each project:

```json
{
  "mcpServers": {
    "bridge": {
      "command": "node",
      "args": ["/path/to/bridge_server/server.js", "--agent-id", "frontend"]
    }
  }
}
```

swap `frontend` with `backend` for the other project.

add the hook to `.claude/settings.json` in each project so it checks inbox automatically:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "bash /path/to/bridge_server/check-inbox.sh frontend"
      }
    ]
  }
}
```

## tools

7 mcp tools: `create_ticket`, `add_to_ticket`, `resolve_ticket`, `close_ticket`, `get_ticket`, `send_message`, `check_inbox`

ticket flow: open -> in_progress -> resolved -> closed. creator opens and closes, the other side works on it and resolves.

## store

json files in `store/` (gitignored, local state only):
- `tickets.json` - tickets and their conversation logs
- `messages.json` - standalone messages
- `delivery.json` - tracks what each agent already saw
