# Reference 2: Single Responsibility

Humans cannot focus on multiple scopes well; code should mirror that constraint.

## Requirements

- A function should have one reason to change.
- A module should own one cohesive responsibility.
- Split mixed concerns (I/O, business logic, formatting, persistence).

## Check

If a unit must be described with "and", it probably has too many responsibilities.
