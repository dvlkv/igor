# AskUserQuestion Support

## Summary

Add support for Claude's `AskUserQuestion` tool in the harness, so when Claude asks the user a structured question during any session (task or general), the question is forwarded to Telegram with inline buttons and the user's answer is sent back to Claude.

## Data Flow

1. Claude emits `tool_use` with `name: "AskUserQuestion"`, `input: { questions: [...] }`
2. Orchestrator's `onToolUse` handler detects this special case
3. For each question in the array, orchestrator calls `telegram.sendQuestion()` — sends a Telegram message with the question text and inline buttons for each option + "Other"
4. User taps a button or replies with free text
5. Orchestrator collects answers in a `pendingQuestions` map keyed by session ID
6. Once all questions for that invocation are answered, orchestrator sends the combined JSON response back to Claude via `sessionManager.sendMessage()`

## Components

### `orchestrator.ts`

- New `pendingQuestions` map: `Map<sessionId, { questions: Question[], answers: Map<questionIndex, string>, threadId: string }>`
- In the existing `onToolUse` callback, detect `toolName === "AskUserQuestion"` and branch to `handleAskUserQuestion()` instead of showing a progress message
- `handleAskUserQuestion()`: iterates over `input.questions`, calls `telegram.sendQuestion()` for each, stores pending state
- `handleQuestionAnswer()`: called when user taps a button or replies with free text. Records the answer, and when all questions are answered, sends the combined response to Claude's stdin via `sendMessage()`
- Modify `handleMessage()`: when a session has pending questions and the user sends free text, treat it as an "Other" answer to the current unanswered question instead of forwarding directly to Claude

### `adapters/telegram.ts`

- `sendQuestion(threadId, questionText, options[], questionId)`: sends a message with the question text and inline buttons. Each button's callback data: `q:<questionId>:<optionIndex>`. Returns the message ID.
- New callback query handler for `q:` prefix (similar to existing `perm:` handler): extracts `questionId` and selected option label, calls a registered `onQuestionAnswer` handler

### `tool-display.ts`

- Add `AskUserQuestion: "Asking a question"` to the map

## Edge Cases

- **Session dies while questions are pending**: Clean up pending questions in existing session exit/cleanup paths.
- **User taps a button after session is gone**: Telegram callback handler checks if the session/pending questions still exist. If not, answers with "Session ended".
- **Multi-select questions**: Buttons toggle on/off and a "Done" button confirms the selection. The answer is sent as comma-separated labels.
- **Free-text "Other" reply**: If the user sends a text message while questions are pending for that session, it's treated as the answer to the first unanswered question.
- **Multiple questions (1-4)**: Each sent as a separate Telegram message. Answers can arrive in any order via buttons. Tracked by question index.

## Open Implementation Detail

The exact stdin JSON format for sending answers back to Claude needs verification during implementation. It may be a plain user message with the answer text, or may need to match the `AskUserQuestion` tool's `answers` schema (`Record<string, string>` keyed by question text). Will be resolved in the RED phase by testing against a real Claude session.

## Files Changed

| File | Change |
|------|--------|
| `harness/src/orchestrator.ts` | Add pendingQuestions state, handleAskUserQuestion, handleQuestionAnswer, modify handleMessage |
| `harness/src/adapters/telegram.ts` | Add sendQuestion method, add `q:` callback query handler, add onQuestionAnswer |
| `harness/src/tool-display.ts` | Add AskUserQuestion entry |
| `harness/src/orchestrator.test.ts` | Tests for question handling flow |
| `harness/src/adapters/telegram.test.ts` | Tests for sendQuestion and callback handling |
| `harness/src/tool-display.test.ts` | Test for new entry |
