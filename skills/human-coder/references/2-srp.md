# Reference 2: Single Responsibility

Humans cannot focus on multiple scopes well; code should mirror that constraint.

## Requirements

- A function should have one reason to change.
- A module should own one cohesive responsibility.
- Split mixed concerns (I/O, business logic, formatting, persistence).

## File Placement

A file's path declares its responsibility. Do not add code that doesn't match. If a file path indicates declarations (types, interfaces, constants), it must not contain runtime logic. If a file path indicates logic (utils, helpers, service), it must not become a dumping ground for type definitions. When you need to add something, find the file whose path matches what you're adding — or create one.

## Check

If a unit must be described with "and", it probably has too many responsibilities.

## Examples

WRONG: adding a mapping function to a declarations file at `src/payments/paymentTypes.ts`
```
// src/payments/paymentTypes.ts
export type PaymentRequest = {
    ...
}

export type PaymentResponse = {
    ...
}

export function getCurrencyByCode(code: string): string {
    return currencyMap[code] ?? code
}
```

RIGHT: types stay at their path, logic goes to a separate module
```
// src/payments/paymentTypes.ts
export type PaymentRequest = {
    ...
}

export type PaymentResponse = {
    ...
}

// src/utils/currencies.ts
export function getCurrencyByCode(code: string): string {
    return currencyMap[code] ?? code
}
```
