import type { Item, Project, Weekspan } from './types.js'

/**
 * Project mutations.
 *
 * Same house style as `marks.ts`: every function here is pure (the input
 * `Weekspan` is never mutated) and every function that can be a no-op
 * returns `null` rather than an equal-but-different copy, so a caller can
 * skip the write. That's the `mutate(apply)` contract the CLI and web app
 * both build on — `null` means "nothing changed, write nothing" — which
 * matters here specifically because it's what keeps an idle edit (renaming
 * a project to the name it already has, re-picking the colour it already
 * has, re-assigning an item to the project it's already in) from showing up
 * as a diff in a synced folder.
 *
 * `addProject` is the one exception to "returns null, never throws": its
 * return type is non-nullable (callers need the new id back), so a blank or
 * duplicate name throws instead. `renameProject` throws for the same two
 * reasons once a project already exists to rename.
 */

/**
 * The project bar colour ramp (design_handoff_todo_ledger/README.md, "Design
 * Tokens": "Project bar colors are assigned per project from barA/B/C…;
 * extend the ramp as projects are added, keeping hue separation and equal
 * lightness within a theme"). The handoff only names barA/B/C explicitly;
 * this extends the same ramp to six tokens so `nextProjectColor` has more
 * room to spread distinct hues before any project has to repeat one.
 *
 * Order matters: it's iteration order for `nextProjectColor`'s tie-break,
 * so a change here changes which colour a fresh weekspan hands out first.
 */
const COLOR_RAMP = ['barA', 'barB', 'barC', 'barD', 'barE', 'barF'] as const

export const PROJECT_COLOR_TOKENS: readonly string[] = COLOR_RAMP

// Base36, lowercase, 7 chars — same shape as item ids (see
// apps/web/src/add/draft.ts `newItemId`): short and readable in a diff,
// collision-checked against every id already in the relevant collection.
// `weekspan-core` has no I/O and is loaded by the browser app directly, so
// this deliberately uses `Math.random()` rather than `node:crypto` — a
// Node-only import here would break that consumer.
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 7

function newProjectId(weekspan: Weekspan): string {
  const existing = new Set(weekspan.projects.map((p) => p.id))
  for (;;) {
    let id = ''
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
    }
    if (!existing.has(id)) return id
  }
}

/** Case-insensitive exact match on project name. */
export function findProjectByName(weekspan: Weekspan, name: string): Project | undefined {
  const target = name.toLowerCase()
  return weekspan.projects.find((p) => p.name.toLowerCase() === target)
}

/**
 * Least-used token in `PROJECT_COLOR_TOKENS`, so newly created projects
 * spread across the ramp instead of repeating a hue while distinct ones
 * remain unused. Ties (including the "no projects yet" case, where every
 * token is tied at zero) break by ramp order, so results are deterministic.
 * Once every token has been used at least once, this still returns the
 * least-repeated one rather than refusing — there is no "ramp exhausted"
 * error, only "start doubling up, evenly."
 *
 * A stray `colorToken` outside the ramp (e.g. hand-edited data) doesn't
 * skew this: only usages of the six known tokens are counted.
 */
export function nextProjectColor(weekspan: Weekspan): string {
  const counts = new Map<string, number>(COLOR_RAMP.map((token) => [token, 0]))
  for (const project of weekspan.projects) {
    if (counts.has(project.colorToken)) {
      counts.set(project.colorToken, (counts.get(project.colorToken) ?? 0) + 1)
    }
  }

  let best: string = COLOR_RAMP[0]
  let bestCount = counts.get(best) ?? 0
  for (const token of COLOR_RAMP) {
    const count = counts.get(token) ?? 0
    if (count < bestCount) {
      best = token
      bestCount = count
    }
  }
  return best
}

/**
 * Create a project, defaulting its colour to `nextProjectColor` when
 * `colorToken` is omitted.
 *
 * Throws — rather than returning `null` — on a blank name (after trimming)
 * or a name that's a case-insensitive duplicate of an existing project.
 * Both are programmer/user errors the caller must handle before this can
 * succeed, not a "nothing to do" no-op: quick-capture's project matcher
 * resolves free-typed text to a project by name, and two projects named
 * "Work"/"work" would make that match ambiguous forever. An explicit,
 * out-of-ramp `colorToken` is rejected the same way `setProjectColor`
 * rejects one, for the same reason (see there).
 *
 * The stored name is the trimmed input — leading/trailing whitespace in a
 * project name has no display purpose and would otherwise make "Work" and
 * "Work " look identical everywhere but sort or compare unequal.
 */
export function addProject(
  weekspan: Weekspan,
  name: string,
  colorToken?: string,
): { weekspan: Weekspan; id: string } {
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new Error('Project name must not be blank')
  }
  if (findProjectByName(weekspan, trimmed)) {
    throw new Error(`A project named ${JSON.stringify(trimmed)} already exists`)
  }

  const token = colorToken ?? nextProjectColor(weekspan)
  if (!PROJECT_COLOR_TOKENS.includes(token)) {
    throw new Error(`Unknown project color token: ${JSON.stringify(token)}`)
  }

  const id = newProjectId(weekspan)
  const project: Project = { id, name: trimmed, colorToken: token }

  return {
    weekspan: { ...weekspan, projects: [...weekspan.projects, project] },
    id,
  }
}

/**
 * Rename a project. `null` for an unknown id or when `name` (trimmed) is
 * exactly the name the project already has — that's the no-op case.
 *
 * A change that only differs in case (`"Work"` -> `"WORK"`) is NOT a no-op:
 * it's a real display change, so it's allowed and does not collide with
 * itself in the duplicate check below (which excludes the project being
 * renamed).
 *
 * Throws on a blank name or a case-insensitive duplicate of a DIFFERENT
 * project, same as `addProject`.
 */
export function renameProject(weekspan: Weekspan, id: string, name: string): Weekspan | null {
  const project = weekspan.projects.find((p) => p.id === id)
  if (!project) return null

  const trimmed = name.trim()
  if (trimmed === '') {
    throw new Error('Project name must not be blank')
  }
  if (trimmed === project.name) return null

  const duplicate = weekspan.projects.find(
    (p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (duplicate) {
    throw new Error(`A project named ${JSON.stringify(trimmed)} already exists`)
  }

  return {
    ...weekspan,
    projects: weekspan.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
  }
}

/**
 * Set a project's colour token. Rejects (throws) a token outside
 * `PROJECT_COLOR_TOKENS` before anything else, the same way `marks.ts`'s
 * `requireValidDate` validates shape before doing any lookup — an arbitrary
 * string would resolve to a CSS variable that doesn't exist and render as no
 * colour at all, which is a bug worth failing loudly for regardless of
 * whether `id` also happens to be unknown.
 *
 * `null` for an unknown project id or a colour equal to the one it already
 * has.
 */
export function setProjectColor(weekspan: Weekspan, id: string, colorToken: string): Weekspan | null {
  if (!PROJECT_COLOR_TOKENS.includes(colorToken)) {
    throw new Error(`Unknown project color token: ${JSON.stringify(colorToken)}`)
  }

  const project = weekspan.projects.find((p) => p.id === id)
  if (!project) return null
  if (project.colorToken === colorToken) return null

  return {
    ...weekspan,
    projects: weekspan.projects.map((p) => (p.id === id ? { ...p, colorToken } : p)),
  }
}

/**
 * What happens to a project's items when the project goes.
 *
 * `unassign` is the default and by far the common case: a project is a
 * long-lived category, and retiring the category rarely means the work in it
 * stopped mattering. `deleteItems` is the bulk-clearout case — real, but rare
 * enough that a caller has to ask for it by name rather than reach it by
 * passing the wrong flag.
 */
export type RemoveProjectMode = 'unassign' | 'deleteItems'

/**
 * Delete a project.
 *
 * With `unassign` (the default) every item that pointed at it has `projectId`
 * set to `null` in the same pass. This is NOT cosmetic: `parse` enforces
 * referential integrity on `projectId` (see parse.ts) and throws on a dangling
 * reference, so removing a project while leaving its id on items would produce
 * a `Weekspan` that fails to round-trip through `parse(serialize(w))` — a
 * corrupt file, not a stale UI.
 *
 * With `deleteItems` those items are removed instead. The cascade then has to
 * reach further than the project: `parentId` and `projectId` are INDEPENDENT
 * axes, so a doomed item can own a child that belongs to some other project (or
 * none). Leaving that child behind would dangle its `parentId`, which `parse`
 * rejects for the same reason — so children of deleted items go too, whatever
 * project they were in. That is the one place this mode removes something the
 * user did not literally name, and it is forced by the file format rather than
 * chosen.
 *
 * `null` for an unknown project id.
 */
export function removeProject(
  weekspan: Weekspan,
  id: string,
  mode: RemoveProjectMode = 'unassign',
): Weekspan | null {
  if (!weekspan.projects.some((p) => p.id === id)) return null

  const projects = weekspan.projects.filter((p) => p.id !== id)

  if (mode === 'unassign') {
    return {
      ...weekspan,
      projects,
      items: weekspan.items.map((item) =>
        item.projectId === id ? { ...item, projectId: null } : item,
      ),
    }
  }

  const doomed = new Set(weekspan.items.filter((i) => i.projectId === id).map((i) => i.id))
  // One pass: nesting is one level deep by construction (see `Item.parentId`).
  for (const item of weekspan.items) {
    if (item.parentId != null && doomed.has(item.parentId)) doomed.add(item.id)
  }

  return { ...weekspan, projects, items: weekspan.items.filter((i) => !doomed.has(i.id)) }
}

/**
 * What `removeProject` would remove, so a caller can say so BEFORE doing it.
 *
 * `directItems` are the ones actually in the project; `orphanedChildren` are
 * sub-items that would be swept up because their parent is going. Counting them
 * separately matters: a confirmation that says "delete 4 items" when it means 6
 * is the kind of undercount people only notice afterwards.
 */
export function projectDeletionImpact(
  weekspan: Weekspan,
  id: string,
): { directItems: Item[]; orphanedChildren: Item[] } {
  const directItems = weekspan.items.filter((i) => i.projectId === id)
  const directIds = new Set(directItems.map((i) => i.id))
  const orphanedChildren = weekspan.items.filter(
    (i) => i.parentId != null && directIds.has(i.parentId) && !directIds.has(i.id),
  )
  return { directItems, orphanedChildren }
}

/**
 * Assign (or, with `projectId: null`, unassign) an item's project.
 *
 * `null` for an unknown item id, an unknown project id (validated the same
 * way `parse` validates `projectId` — silently refusing to write a
 * dangling reference rather than throwing, since resolving a typed/typo'd
 * project name to nothing is an expected "no match" outcome for callers
 * like quick-capture, not an exceptional one), or when the item already has
 * exactly that `projectId` (including "already unassigned" when
 * `projectId` is `null`).
 */
export function assignProject(
  weekspan: Weekspan,
  itemId: string,
  projectId: string | null,
): Weekspan | null {
  const item = weekspan.items.find((i) => i.id === itemId)
  if (!item) return null

  if (projectId !== null && !weekspan.projects.some((p) => p.id === projectId)) return null

  const current = item.projectId ?? null
  if (current === projectId) return null

  return {
    ...weekspan,
    items: weekspan.items.map((i) => (i.id === itemId ? { ...i, projectId } : i)),
  }
}
