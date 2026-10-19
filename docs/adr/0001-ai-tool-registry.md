# 0001: AI works through one tool registry

Status: accepted (2026-10-19)

## Context

Knecht should become AI native: the dashboard uses AI in several places (failure diagnosis, workflow creation, later a global assistant), an MCP server lets external clients use Knecht, and the sandbox agent already talks to Knecht through the agent bridge. Each of these would otherwise grow its own way to read and change Knecht data, with its own permission checks and its own idea of what the AI may see.

The AI should also learn how Knecht works without docs or external fetches, and it may only see and change what it is allowed to.

## Decision

### One registry of tools

All AI access goes through a server-side tool registry (`server/tools`). A tool has a name, a description, a zod input schema, a scope and a run function. The same tools serve the dashboard features, MCP and, later, the sandbox agent.

Tools and API routes share their functions: logic that lives in a route today moves into a function both call, one tool at a time. In the long run the tools become the domain layer.

### Scopes are resource plus verb

A scope is `resource:verb` with the verb `read` or `write`, for example `runs:read` or `workflows:write`. Members are all equal, so in the dashboard a member holds every scope; scopes restrict MCP tokens and the system actor.

### The actor

Every tool call has an actor: a member (by login) or the system. AI in the dashboard acts on behalf of the member who uses it. Background work such as the failure diagnosis acts as the system, and the system may only call read tools. Background features still call tools through the registry, so they are checked and audited like any other caller.

Open for phase 6: the sandbox agent writes (comments, labels, status), so its actor cannot be the system. It is either the member who started the run or a third actor kind for the run.

### Tools per feature are fixed in code

Each micro-agent gets a fixed list of tools from its feature. There is no dynamic tool discovery inside the dashboard.

### Knowledge through introspection

The AI learns Knecht from the running instance: the action schemas as JSON Schema, the workflow document format, the glossary (`CONTEXT.md`, bundled into the server build) and live data. It gets no docs and no source code.

### Approval

In the dashboard every write needs approval: the AI proposes the change in place, and the member applies or discards it. Through MCP Knecht asks for no approval: the granted scope is the only gate, and confirming is left to the client.

### Audit

Every tool call is recorded: actor, channel (for example dashboard, MCP, daemon), tool, input, error and duration. Results are not stored. Records are deleted after 90 days by the GC.

### MCP

Knecht becomes its own OAuth 2.1 authorization server: dynamic client registration, login through GitHub, and a consent page for the scopes. Access tokens live about an hour, refresh tokens 30 days with sliding renewal. Members can revoke connected clients in the settings.

### UI

AI starts embedded in existing views. A global assistant is planned but comes later.

## Phases

1. Registry, read tools (runs and step logs, projects, workflows, Knecht knowledge) and the audit log.
2. Failure diagnosis: one model call whose data is gathered through registry tools as the system, answering `{ summary, steps }`.
3. MCP with OAuth, read scopes first.
4. Write tools with in-place approval, and workflow creation.
5. Global assistant.
6. The sandbox agent bridge moves into the registry; opencode gets the tools through MCP with the session token.

## Consequences

- Permission checks and the audit live in one place instead of in every feature.
- Routes and tools drift unless shared functions are pulled out; new read paths should start as tools.
- Tool inputs are stored for 90 days, so tools must not take secrets as input.
- A single model call (phase 2) keeps the diagnosis cheap and predictable; a tool loop is only needed once the model has to decide what to look at.
