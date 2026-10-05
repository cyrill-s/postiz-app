# Public API post group editing

Source changes are uncommitted in the deployed-source checkout. No dependencies,
schema migration, orchestrator activity changes or workflow bundle changes are
required.

The public controller exposes GET and PUT `/public/v1/posts/group/:group` using
the existing organization authentication. Both return live roots only, with
`{ group, publishDate, state, posts: [{ id, integrationId, content, imageCount }] }`.
Since there is no separate group row, the first live root ordered by id supplies
the group's date and state if existing roots differ.

PUT validates the DTO and all surviving affected roots before writing. It rebuilds
the existing root and thread values for `validatePosts`, following
`updatePostSettings`, including existing media, settings and delays. Drafts retain
the existing create/settings validation rules: empty content without media is
rejected; incomplete settings and provider limits are permitted while drafting.
The requested five-minute guard applies to every affected root, including drafts.

The repository performs content, date and scoped soft deletes in one Prisma
transaction. Root writes recheck organization, group, live/root status, allowed
state, the five-minute boundary and the validated `updatedAt` snapshot. Content
updates write only root content and its modification timestamp. Images, settings,
tags, thread rows, delays, integration, repeat interval and group remain stored
as they were. Date updates also move surviving children, preserving their states;
removed roots and their descendants are soft-deleted.

The stable group behavior is the intent of `keepGroup=true`. This path uses narrow
updates rather than `createPost` because the existing `createOrUpdatePost` sweep
with `keepGroup=true` deletes every group member outside the submitted root's
values (`libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts:789`),
including sibling channels. Reusing that sweep would violate this endpoint's
preservation contract. Existing dashboard/settings paths were left unchanged.

Temporal operations happen after the database transaction, using the same awaited
`startWorkflow` path as `changeDate(..., 'schedule')` for every surviving moved
root. Removed roots use that termination path with DRAFT so nothing new starts.
Database changes are atomic; database and Temporal cannot commit together, and
the existing workflow client's best-effort error handling still applies.

## Changed files

- `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts`
- `libraries/nestjs-libraries/src/dtos/posts/update.post.group.dto.ts`
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts`
- `apps/backend/src/public-api/routes/v1/public.post.group.spec.ts`
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.group.spec.ts`
- `jest.post-edit.config.cjs`
- `ops/post-edit/README.md`

## Compiled overlay modules

Use the module-list approach from `ops/telegram/package-native.py:23`. The exact
module stems are:

```python
shared = [
    'libraries/nestjs-libraries/src/database/prisma/posts/posts.service',
    'libraries/nestjs-libraries/src/database/prisma/posts/posts.repository',
    'libraries/nestjs-libraries/src/dtos/posts/update.post.group.dto',
]
backend_only = [
    'apps/backend/src/public-api/routes/v1/public.integrations.controller',
]
for app in ['backend', 'orchestrator']:
    modules = shared + (backend_only if app == 'backend' else [])
    for module in modules:
        for extension in ['.js', '.js.map', '.d.ts']:
            relative = f'apps/{app}/dist/{module}{extension}'
            # Copy this compiled artifact into the overlay at the same path.
```

This is 12 backend artifacts and 9 orchestrator artifacts. The shared repository
now injects the already-registered `PrismaTransaction`; no module registration
change is needed. The new DTO is a runtime import of the shared service, so it
must be included in both overlays. No workflow bundle artifact is overlaid.
The existing packaging script requires a commit; do not run it on this checkout.

## Workflow evidence

- `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts:153`
  loads the initial post; `:168` sleeps using its saved publish date. Updating
  the database date alone cannot change an already-running sleep.
- The same workflow at `:182` calls `getPostsList` after sleeping. Its activity
  at `apps/orchestrator/src/activities/post.activity.ts:192` reloads the root
  and comments through `getPostsRecursively`, which reads live rows through
  `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:312`
  and `posts.repository.ts:455`. Thus content edits are read at publication time.
- `apps/orchestrator/src/activities/post.activity.ts:263` compiles the reloaded
  `post.content` into the provider payload (plain content at `:277`).
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:918`
  awaits termination of running workflows found by post id; `:924` exits for
  drafts; `:931` starts `postWorkflowV112` using the stable `post_${postId}` id
  and `TERMINATE_EXISTING`. The new route calls this path at `:704` after its
  date/soft-delete transaction commits. Restarted workflows read the new date,
  replacing the old timer in the same way as dashboard rescheduling at `:1474`.
- `apps/backend/src/public-api/public.api.module.ts:36` applies the existing
  `PublicAuthMiddleware` to this controller, including both new routes.

## Validation for the lead

Code and specs were self-reviewed. Compilation and Jest were not run because
this checkout has no node_modules and installation was explicitly prohibited.
The focused command to run from the deployed-image build container is:

```sh
pnpm exec jest --config jest.post-edit.config.cjs --runInBand
```

The service/repository suite uses actual `validatePosts`, provider settings DTO
validation and a transactional Prisma model mock. It covers org isolation, exact
GET shape, sibling/media/settings/tag/thread preservation, date/workflow restart,
scoped removal, combined changes, draft handling, all requested status codes,
provider limits, the five-minute boundary, validation before writes, write-time
state/time/version checks and rollback. The HTTP suite uses the actual controller
and organization decorator with service and authentication-result stubs; it
checks route methods, 200 responses and unchanged 400/404/409 error bodies.

Compile backend and orchestrator in that container and overlay the listed modules
only, keeping its deployed Temporal workflow bundle.
