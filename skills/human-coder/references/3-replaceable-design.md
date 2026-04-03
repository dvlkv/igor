# Reference 3: Replaceable Design

Imagine the probability of the specific part replacement, from 0 to 10. If it is greater than 3, design that so it can be swapped without rewriting any other logic.

## Requirements

- Depend on contracts, not concrete implementations.
- Inject external dependencies (DB, HTTP clients, file systems, clocks).
- Keep side effects at edges; keep core logic pure when possible.

## Check

If replacing an implementation forces widespread edits, coupling is too high.
