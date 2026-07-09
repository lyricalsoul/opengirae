# openGIRAÊ

![](.github/image-4.png)

This is the source code for Giraê, a gacha game for chat platforms.
This repository contains a complete rewrite of the original version, previously announced as the Kitsch project. This new iteration updates the visual identity and overhauls the codebase by introducing a resilient worker architecture with comprehensive TypeScript typings.
Inconsistencies across executions have been remediated by enforcing a DBOS workflow-based system for mission-critical logic, ensuring the application remains scalable, robust, and clean.

## Architecture

Giraê is designed to be highly modular and easily scalable. While the legacy version implemented a rudimentary modular design, its reliance on heavy local state severely limited its scalability. In this rewrite, DBOS and BullMQ are heavily leveraged throughout the application to enforce a strict worker-based architecture, ensuring consistency and reliability across all executions.

A detailed execution flow can be found in `flow.mermaid`. At a high level, the event pipeline operates as follows:
```
telegram/discord -> inbounder --bullMQ-> commandeer --bullMQ-> answerer -> telegram/discord
```


## Packages

- `@girae/common` - Shared constants, utilities, and types for all other workers. Exports BullMQ queues used across workers.
- `@girae/database` - Database access layer, using Drizzle and DBOS Drizzle Datasource.
- `@girae/inbounder` - Receives incoming events from platforms (currently Telegram and Discord), checks if they are valid, and routes them to the `commandeer`.
- `@girae/commandeer` - Implements the command engine, and pushes results back to the `answerer` queue.
- `@girae/answerer` - Sends answers back to platforms with the appropriate formatting and rate limiting.

