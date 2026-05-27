# Repository Issue Backlog — May 2026

## #35 — [P0] Eliminate accidental service-role usage from client server code

**Scope:** client-api
**Priority:** P0

**Summary:**
The client package included `SUPABASE_SERVICE_ROLE_KEY` in its environment configuration schema and validation script. This made the privileged service-role key accessible to any Next.js API route importing `@/lib/api/env`, creating a vector for accidental privilege escalation.

**Resolution:**
- Removed `SUPABASE_SERVICE_ROLE_KEY` from `client/lib/api/env.ts` schema and parser
- Removed `SUPABASE_SERVICE_ROLE_KEY` from `client/scripts/validate-env.js` required vars list
- Removed docs references in `client/README.md` and `client/BACKEND_DOCUMENTATION.md`
- Added test coverage (`client/lib/api/env.test.ts`) confirming the key is excluded
- The `backend/` package retains its own `SUPABASE_SERVICE_ROLE_KEY` usage (justified — backend needs admin privileges for auth admin operations and internal services)

**Service-role justification in backend:**
- `backend/lib/supabase.ts` — direct service-role client for backend-internal DB access
- `backend/src/config/database.ts` — service-role client with connection pool monitoring
- `backend/src/routes/user.ts:104` — `supabase.auth.admin.deleteUser()` requires admin privileges
- `scripts/*` — admin-level RLS audit scripts (offline use only)
