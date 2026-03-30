# Reference 1: DRY

Do not repeat logic, structure, or constants in multiple places. Always try to use existing logic before writing anything new.

## Requirements

- Extract repeated behavior into one reusable unit.
- Keep one source of truth for business rules.
- Prefer composition over copy-paste.

## Check

If the same change must be made in two places, the design is wrong. 

## Examples
WRONG ASSUMPTION:
```
Constant enum is used in different places so I need to create another constant.
```
RIGHT ASSUMPTION:
```
Enum is already a constant, no need to change anything.
```

BAD CODE:
```
// Signs agreements and changes customer status
function signAgreements(db) {
    ...agreement signature code...

    // Repository operation
    await db.customer.update({
        status: 'ACTIVE'
    })

    // Audit event
    await db.eventLog.insert({ type: 'customer-updated', nextStatus: 'ACTIVE' })
}

function updateCustomerStatus(db, status) {
    // Repository operation
    await db.customer.update({
        status: status
    })

    // Audit event
    await db.eventLog.insert({ type: 'customer-updated', nextStatus: status })
}
```


GOOD CODE (follows DRY): 
```
// Signs agreements and changes customer status
function signAgreements(db) {
    ...agreement signature code...

    // Repository operation
    await updateCustomerStatus(db, 'ACTIVE')
}

function updateCustomerStatus(db, status) {
    // Repository operation
    await db.customer.update({
        status: status
    })

    // Audit event
    await db.eventLog.insert({ type: 'customer-updated', nextStatus: status })
}
```