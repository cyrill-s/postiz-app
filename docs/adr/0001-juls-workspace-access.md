# Juls owns Workspaces; Postiz owns social connections

Juls provisions one Managed Organization and isolated Workspace Principal per Workspace through a first-party signed HTTP interface. We deliberately do not mirror human users or match email addresses: Juls currently has no email identity, and Postiz's normal user session can switch organizations. Existing OAuth grants remain the credential used by MCP; bootstrap codes and browser tickets are short-lived capabilities, and access revocation retains a terminal tombstone so delayed jobs cannot resurrect access.

Provision retries preserve and recover the same OAuth token instead of rotating it, so an uncertain network outcome cannot invalidate a credential already persisted by another worker. Shared instance credentials authorize lifecycle operations only; they are never agent credentials. Tariff policy and cancellation/erasure of accepted work require separate contracts, not invented plan mappings.
