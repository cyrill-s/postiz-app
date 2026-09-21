# Postiz managed social publishing

## Language

**Juls Workspace**:
The subscription, data and collaboration scope owned by Juls.
_Avoid_: Account, shared organization

**Managed Organization**:
A Postiz organization dedicated to one Juls Workspace.
_Avoid_: Juls user, founder organization

**Workspace Principal**:
The Postiz identity representing a Managed Organization, on whose behalf Juls authorizes access. It is distinct from the human Juls owner.
_Avoid_: Mirrored user, shared login

**Social Connection**:
A channel authorized by its user at a social provider and managed by Postiz.
_Avoid_: Juls login, Workspace Principal

**Access Revocation**:
The terminal withdrawal of Juls and browser access to a Managed Organization. It does not mean erasure of social data or cancellation of accepted publishing work.
_Avoid_: Workspace deletion, deprovisioning
