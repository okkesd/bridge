#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(__dirname, "store");

// Parse --agent-id
const agentIdIndex = process.argv.indexOf("--agent-id");
if (agentIdIndex === -1 || !process.argv[agentIdIndex + 1]) {
  console.error("Usage: node server.js --agent-id <frontend|backend>");
  process.exit(1);
}
const AGENT_ID = process.argv[agentIdIndex + 1];

// --- File helpers with atomic writes ---

function readJSON(filename) {
  const filepath = path.join(STORE, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function writeJSON(filename, data) {
  const filepath = path.join(STORE, filename);
  const tmp = filepath + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filepath);
}

// --- MCP Server ---

const server = new McpServer({
  name: "bridge",
  version: "1.0.0",
});

// 1. create_ticket
server.tool(
  "create_ticket",
  "Create a new ticket. Fails if a non-closed ticket already exists.",
  { body: z.string().describe("Description of what you need") },
  async ({ body }) => {
    const store = readJSON("tickets.json");
    const active = store.tickets.find((t) => t.status !== "closed");
    if (active) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Ticket #${active.id} is still ${active.status}. Close it before creating a new one.`,
          },
        ],
      };
    }

    const ticket = {
      id: store.tickets.length + 1,
      status: "open",
      created_by: AGENT_ID,
      created_at: new Date().toISOString(),
      resolved_summary: null,
      log: [
        {
          from: AGENT_ID,
          body,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    store.tickets.push(ticket);
    writeJSON("tickets.json", store);

    return {
      content: [
        { type: "text", text: `Ticket #${ticket.id} created.` },
      ],
    };
  }
);

// 2. add_to_ticket
server.tool(
  "add_to_ticket",
  "Add a message to an existing ticket's log.",
  {
    ticket_id: z.number().describe("Ticket ID"),
    body: z.string().describe("Message to add"),
  },
  async ({ ticket_id, body }) => {
    const store = readJSON("tickets.json");
    const ticket = store.tickets.find((t) => t.id === ticket_id);
    if (!ticket) {
      return {
        content: [{ type: "text", text: `Error: Ticket #${ticket_id} not found.` }],
      };
    }
    if (ticket.status === "closed") {
      return {
        content: [{ type: "text", text: `Error: Ticket #${ticket_id} is closed.` }],
      };
    }

    ticket.log.push({
      from: AGENT_ID,
      body,
      timestamp: new Date().toISOString(),
    });

    // Auto-transition: if open and caller is not creator, move to in_progress
    if (ticket.status === "open" && AGENT_ID !== ticket.created_by) {
      ticket.status = "in_progress";
    }

    writeJSON("tickets.json", store);

    return {
      content: [
        {
          type: "text",
          text: `Added to ticket #${ticket_id}. Log now has ${ticket.log.length} entries. Status: ${ticket.status}`,
        },
      ],
    };
  }
);

// 3. resolve_ticket
server.tool(
  "resolve_ticket",
  "Resolve a ticket. Only callable by the non-creator.",
  {
    ticket_id: z.number().describe("Ticket ID"),
    summary: z.string().describe("Summary of what was done"),
  },
  async ({ ticket_id, summary }) => {
    const store = readJSON("tickets.json");
    const ticket = store.tickets.find((t) => t.id === ticket_id);
    if (!ticket) {
      return {
        content: [{ type: "text", text: `Error: Ticket #${ticket_id} not found.` }],
      };
    }
    if (ticket.created_by === AGENT_ID) {
      return {
        content: [
          { type: "text", text: `Error: Only the non-creator can resolve a ticket.` },
        ],
      };
    }
    if (ticket.status === "closed" || ticket.status === "resolved") {
      return {
        content: [
          { type: "text", text: `Error: Ticket #${ticket_id} is already ${ticket.status}.` },
        ],
      };
    }

    ticket.status = "resolved";
    ticket.resolved_summary = summary;
    ticket.log.push({
      from: AGENT_ID,
      body: `[RESOLVED] ${summary}`,
      timestamp: new Date().toISOString(),
    });
    writeJSON("tickets.json", store);

    return {
      content: [{ type: "text", text: `Ticket #${ticket_id} resolved.` }],
    };
  }
);

// 4. close_ticket
server.tool(
  "close_ticket",
  "Close a resolved ticket. Only callable by the creator.",
  {
    ticket_id: z.number().describe("Ticket ID"),
  },
  async ({ ticket_id }) => {
    const store = readJSON("tickets.json");
    const ticket = store.tickets.find((t) => t.id === ticket_id);
    if (!ticket) {
      return {
        content: [{ type: "text", text: `Error: Ticket #${ticket_id} not found.` }],
      };
    }
    if (ticket.created_by !== AGENT_ID) {
      return {
        content: [
          { type: "text", text: `Error: Only the creator can close a ticket.` },
        ],
      };
    }

    ticket.status = "closed";
    writeJSON("tickets.json", store);

    return {
      content: [{ type: "text", text: `Ticket #${ticket_id} closed.` }],
    };
  }
);

// 5. get_ticket
server.tool(
  "get_ticket",
  "Get a ticket with its full log. Defaults to the active ticket.",
  {
    ticket_id: z.number().optional().describe("Ticket ID (defaults to active ticket)"),
  },
  async ({ ticket_id }) => {
    const store = readJSON("tickets.json");
    let ticket;
    if (ticket_id !== undefined) {
      ticket = store.tickets.find((t) => t.id === ticket_id);
    } else {
      ticket = store.tickets.find((t) => t.status !== "closed");
    }

    if (!ticket) {
      return {
        content: [{ type: "text", text: "No ticket found." }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
    };
  }
);

// 6. send_message
server.tool(
  "send_message",
  "Send a fire-and-forget message to the other agent.",
  {
    to: z.string().describe("Recipient agent id (frontend or backend)"),
    body: z.string().describe("Message body"),
  },
  async ({ to, body }) => {
    const store = readJSON("messages.json");
    const msg = {
      id: store.messages.length + 1,
      from: AGENT_ID,
      to,
      body,
      timestamp: new Date().toISOString(),
    };
    store.messages.push(msg);
    writeJSON("messages.json", store);

    return {
      content: [{ type: "text", text: `Message #${msg.id} sent to ${to}.` }],
    };
  }
);

// 7. check_inbox
server.tool(
  "check_inbox",
  "Check for new messages and ticket updates since last check.",
  {},
  async () => {
    const messages = readJSON("messages.json");
    const tickets = readJSON("tickets.json");
    const delivery = readJSON("delivery.json");

    if (!delivery[AGENT_ID]) {
      delivery[AGENT_ID] = { last_message_seen: 0, last_ticket_log_seen: {} };
    }
    const cursor = delivery[AGENT_ID];

    // New messages addressed to this agent
    const newMessages = messages.messages.filter(
      (m) => m.to === AGENT_ID && m.id > cursor.last_message_seen
    );

    // New ticket log entries on non-closed tickets where this agent is a participant
    const ticketUpdates = [];
    for (const ticket of tickets.tickets) {
      if (ticket.status === "closed") continue;
      // Agent is a participant if they created it or have a log entry
      const isParticipant =
        ticket.created_by === AGENT_ID ||
        ticket.log.some((e) => e.from === AGENT_ID);
      if (!isParticipant) continue;

      const lastSeen = cursor.last_ticket_log_seen[ticket.id] || 0;
      const newEntries = ticket.log.slice(lastSeen).filter((e) => e.from !== AGENT_ID);
      if (newEntries.length > 0) {
        ticketUpdates.push({
          ticket_id: ticket.id,
          status: ticket.status,
          new_entries: newEntries,
        });
      }
      cursor.last_ticket_log_seen[ticket.id] = ticket.log.length;
    }

    // Update message cursor
    if (newMessages.length > 0) {
      cursor.last_message_seen = newMessages[newMessages.length - 1].id;
    }

    writeJSON("delivery.json", delivery);

    if (newMessages.length === 0 && ticketUpdates.length === 0) {
      return {
        content: [{ type: "text", text: "No new messages or ticket updates." }],
      };
    }

    const result = { messages: newMessages, ticket_updates: ticketUpdates };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
