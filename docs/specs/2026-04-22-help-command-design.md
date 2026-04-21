# Help Command Design

## Scope

Add a `/help` Telegram command that replies with a list of available bot commands and their descriptions.

## Architecture

**Single source of truth:** Extract command metadata (name + description) into an exported `COMMANDS` constant array in `telegram.ts`. Both the `/help` reply formatter and `setMyCommands` consume this array.

**No new files.** The help handler lives alongside existing command handlers in `telegram.ts`.

## Changes

### `harness/src/adapters/telegram.ts`

1. Add exported `COMMANDS` array: `{ command: string, description: string }[]`
2. Add `bot.command("help", ...)` that formats `COMMANDS` into a Markdown message and calls `ctx.reply()`
3. Update `start()` to pass `COMMANDS` to `setMyCommands` instead of a hardcoded array

### Help message format

```
/task — Create a new task
/done — Complete a task
/clear — Clear and restart the general session
/help — Show available commands
```

## Testing

Unit test in `telegram.test.ts`:
- Verify `/help` command handler is registered
- Verify help handler calls `ctx.reply` with text containing all command names
- Verify `COMMANDS` array is used by `setMyCommands`
