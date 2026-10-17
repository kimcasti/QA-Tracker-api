# Security hardening: local validation and future release

## Scope

These changes are developed locally on `security/tenant-invitations-hardening` in the separate API and client repositories. Creating this branch does not deploy either service. Do not push, deploy, run migrations, send real invitation emails or change production accounts as part of local validation.

The hardening addresses invitation ownership, source-resource authorization, organization-specific roles, initial-user bootstrap and UAT participant references. It does not certify all endpoints or infrastructure, establish backup recovery, add rate limits everywhere, or replace an independent security review.

## Local safety checks

- Verify the active branch in **both** repositories; the parent folder is not the Git repository.
- Use a supported Node version. Docker/CI use Node 20; invoke a local Node 20 explicitly instead of changing the user's global Node installation.
- Unit tests must use isolated fixtures and must not bootstrap a real Strapi instance. A socket-blocking preload can be used to prevent accidental live connections.
- Before any later integration/E2E run, verify the effective API URL, database destination, email transport and external credentials. A localhost frontend does not imply a local backend, and localhost DB may be a production tunnel.
- Never use production credentials or customer SQL dumps as fixtures. Do not expose invitation tokens, passwords or encryption keys in test logs.

## Required regression scenarios

### Invitations

- Missing, malformed, wrong, expired, previously consumed and recipient-mismatched proofs cannot claim an existing invitation.
- The correct recipient can use a valid invitation once; a second use is rejected.
- Resending invalidates the previous proof.
- Existing registered users keep normal sign-in; legacy pending invitations require a secure resend rather than silent acceptance by email.
- Normal organization signup cannot inherit a membership simply by choosing another person's email.
- Organization/project role assignments and invitation lists do not expose secrets.

### Tenant isolation

- A foreign record cannot be updated by attaching a permitted destination organization/project to the payload.
- Authorization checks the persisted source and separately checks any proposed destination. Organization reassignment is not implicitly allowed.
- An owner role in organization A cannot grant owner actions in organization B where the user is a viewer.
- Restricted users cannot access or move records through projects outside their allowed scope.
- Legitimate own-organization list/create/read/update/delete flows remain allowed according to the action's role requirements.

### Bootstrap and UAT

- Production startup without explicit seed credentials does not create a fallback privileged account.
- Existing accounts are not deleted or reset by this change. Partial seed configuration is handled explicitly and safely.
- UAT participants must belong to the session's organization and applicable project; foreign references fail before session writes.
- Optional participants, signed token validation, expiration, revocation and completion locking retain their documented behavior.

## Before any future production deployment

1. Review the full API/client diff and independent review results. Record exact commits and deploy the matching versions.
2. Identify current production configuration without copying secrets to this document. Check initial/admin account ownership and email delivery separately.
3. Inventory pending invitations and plan secure resend. Explain any required user action before changing the flow.
4. Inspect existing UAT participant relationships and multi-organization roles using authorized read-only queries; do not auto-delete inconsistent data.
5. Confirm a restorable backup of database, evidence objects and required encryption keys. Test restoration on an isolated destination first.
6. Review schema changes, if any, with the actual Strapi/database version. Never assume application rollback reverses a schema change. Retain new optional columns during an application rollback unless removal is separately proven safe.
7. Validate on staging with synthetic organizations and an isolated mailbox. Include two-tenant negative tests and normal login/invitation/UAT flows.
8. Obtain explicit deployment authorization. Monitor authentication/authorization error rates and support reports after release.

## Rollback cautions

An application rollback may restore insecure invitation or permission behavior. Prefer a safe forward fix or temporarily disable the affected flow rather than reopening a confirmed access-control flaw. Do not restore the entire production database to solve a single-client problem. Any database restore must account for revoked tokens, accepted invitations and permissions that could otherwise reappear.

No production availability, backup schedule, RPO, RTO, migration success or externally delivered email is established by passing the isolated unit tests.
