#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(__dirname, "store");

const agentIdIndex = process.argv.indexOf("--agent-id");
if (agentIdIndex === -1 || !process.argv[agentIdIndex + 1]) {
  process.exit(1);
}
const AGENT_ID = process.argv[agentIdIndex + 1];

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(STORE, filename), "utf-8"));
}

function writeJSON(filename, data) {
  const filepath = path.join(STORE, filename);
  const tmp = filepath + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filepath);
}

const messages = readJSON("messages.json");
const tickets = readJSON("tickets.json");
const delivery = readJSON("delivery.json");

if (!delivery[AGENT_ID]) {
  delivery[AGENT_ID] = { last_message_seen: 0, last_ticket_log_seen: {} };
}
const cursor = delivery[AGENT_ID];

const lines = [];

// New messages
const newMessages = messages.messages.filter(
  (m) => m.to === AGENT_ID && m.id > cursor.last_message_seen
);
for (const m of newMessages) {
  lines.push(`[Message #${m.id} from ${m.from}]: ${m.body}`);
}

// New ticket log entries
for (const ticket of tickets.tickets) {
  if (ticket.status === "closed") continue;
  // Both agents see all non-closed tickets
  const lastSeen = cursor.last_ticket_log_seen[ticket.id] || 0;
  const newEntries = ticket.log.slice(lastSeen).filter((e) => e.from !== AGENT_ID);
  for (const e of newEntries) {
    lines.push(`[Ticket #${ticket.id} - ${e.from}]: ${e.body}`);
  }
  cursor.last_ticket_log_seen[ticket.id] = ticket.log.length;
}

// Update cursors
if (newMessages.length > 0) {
  cursor.last_message_seen = newMessages[newMessages.length - 1].id;
}
writeJSON("delivery.json", delivery);

// Only print if there's something new
if (lines.length > 0) {
  console.log("---");
  console.log("BRIDGE: New messages from other agent");
  console.log("---");
  for (const line of lines) {
    console.log(line);
  }
  console.log("---");
}
