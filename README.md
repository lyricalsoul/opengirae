# openGIRAÊ

## Packages

- `@girae/common` - Shared constants, utilities, and types for all other workers
- `@girae/database` - Database access layer
- `@girae/inbounder` - Receives incoming events from Telegram, checks if they are valid, and routes them to the `commandeer`
- `@girae/commandeer` - Implements the command engine, and pushes results back to the `answerer` queue
- `@girae/answerer` - Sends answers back to Telegram with the appropriate formatting and rate limiting
- `@girae/analytics` - Implements `QueueEvent` processing for analytics and monitoring
