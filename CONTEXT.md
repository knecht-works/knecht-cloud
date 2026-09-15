# Knecht

Knecht runs agent workflows against GitHub repositories, started by events from external tools (GitHub, Jira) or by hand, and talks back to the place the work came from.

## Language

### Automation

**Workflow**:
An ordered list of steps an agent executes. Has a draft and a published version; only a published, enabled workflow can be started by a trigger.

**Trigger**:
The binding of one workflow to a project plus a firing condition. Every trigger has exactly one source.

**Source**:
The mechanism that fires a trigger: schedule, manual, or an integration (github, jira).
_Avoid_: Kind, trigger type

**Run**:
One execution of a workflow on one project, inside a session.

**Inputs**:
The fixed set of values a source hands to a run about the thing that fired it: event, identifier, title, body, url, status, assignee, labels, author. Every source supplies every key, empty where the concept does not exist, so a workflow works unchanged under any trigger. People appear by the name the tool shows.

### Integrations

**Integration**:
An external tool Knecht receives events from and writes results back to (GitHub, Jira). Schedule and manual are not integrations.
_Avoid_: Provider, trigger source (when meaning the tool rather than the mechanism)

**Connection**:
The stored credentials Knecht uses to talk to one integration. One connection per integration for the whole instance.
_Avoid_: App (for the credential record), setup

**Object**:
The external thing a session belongs to: a GitHub issue, a GitHub pull request, or a Jira ticket. Identified by its integration, kind, and key.
_Avoid_: Ticket, issue (when meaning the generic concept)

**Mention**:
A comment on an object that addresses Knecht, written by someone other than Knecht itself. A mention on a session's object creates a follow-up.

**Project link**:
The binding of a project to one external container of an integration (a Jira project). At most one per integration and project, and an external container links to at most one project. Triggers of a linked integration fire for exactly one linked project.

**Capability**:
An action an integration can perform on its objects on the agent's behalf: comment, label, set status. Not every integration has every capability.

### Work

**Project**:
A connected GitHub repository. The unit a run checks out and opens pull requests against.
_Avoid_: Repo (in domain language)

**Session**:
The durable working context for one object in one project: a checkout, an environment, a preview. Runs and follow-ups on the same object share one session.

**Follow-up**:
An additional prompt appended to a finished run's session. Comes from the dashboard or from a mention.

**Member**:
A person allowed to use this Knecht instance and to address it via mentions.
