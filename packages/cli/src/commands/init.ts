/**
 * `weekspan init` — create a new weekspan.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWeekspan } from '@weekspan/weekspan-core'
import type { Command, CommandContext } from '../command.js'
import { EXIT, type ExitCode } from '../exit.js'
import { createWeekspanFile, ensureSchemaFile } from '../io.js'
import { existsSync, writeFileSync } from 'node:fs'
import { createOutput, type Output } from '../output.js'
import { schemaPath } from '../config.js'

/**
 * The generated JSON Schema, read from weekspan-core. The weekspan's own `$schema`
 * is the RELATIVE path `./weekspan.schema.json`, so without a copy beside the
 * file, editor validation silently resolves to nothing.
 */
function loadSchemaJson(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../../weekspan-core/weekspan.schema.json'),
    path.resolve(here, '../../weekspan-core/weekspan.schema.json'),
    // Beside the executable. `npm run release` bundles the CLI into a single
    // file and copies it out of the workspace, which puts weekspan-core's
    // directory permanently out of reach of the two relative paths above — so
    // `init` on a fresh machine silently shipped no schema and, via the same
    // resolution problem in loadTemplate, no AGENTS.md/CLAUDE.md either.
    path.resolve(here, './weekspan.schema.json'),
  ]
  for (const c of candidates) {
    try {
      return readFileSync(c, 'utf8')
    } catch {
      continue
    }
  }
  return undefined
}

function loadTemplate(name: string): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const c of [
    path.resolve(here, `../../templates/${name}`),
    path.resolve(here, `../templates/${name}`),
    path.resolve(here, `./templates/${name}`),
  ]) {
    try {
      return readFileSync(c, 'utf8')
    } catch {
      continue
    }
  }
  return undefined
}

export async function runInit(
  ctx: CommandContext,
  out: Output = createOutput({ json: ctx.json }),
): Promise<ExitCode> {
  const positional = ctx.argv.find((a) => !a.startsWith('-'))
  const target = positional ? path.resolve(positional) : ctx.weekspanPath

  await createWeekspanFile(target, createWeekspan())

  const schemaJson = loadSchemaJson()
  let wroteSchema = false
  if (schemaJson) {
    wroteSchema = await ensureSchemaFile(target, schemaJson)
  } else {
    // Not fatal: the weekspan is valid without it, only editor validation is lost.
    out.warn('Could not locate weekspan.schema.json; editor validation will be unavailable.')
  }

  // Agent-facing instructions in the weekspan FOLDER, so any agent pointed at this
  // directory picks them up without being told. Three mechanisms, none individually
  // reliable: these files, the skill that bundles the CLI, and the `$agent` warning
  // inside the weekspan itself for an agent that arrives with no folder context.
  const docs: string[] = []
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const dest = path.join(path.dirname(target), name)
    // Never clobber: the user may have their own instructions in this folder.
    if (existsSync(dest)) continue
    const body = loadTemplate(name)
    if (!body) continue
    writeFileSync(dest, body, 'utf8')
    docs.push(dest)
  }

  out.data(
    [
      `Created ${target}`,
      wroteSchema ? `Created ${schemaPath(target)}` : '',
      ...docs.map((d) => `Created ${d}`),
      '',
      'Next:  weekspan add "your first task" --due today',
    ]
      .filter(Boolean)
      .join('\n'),
    { created: target, schema: wroteSchema ? schemaPath(target) : null, docs },
  )
  return EXIT.OK
}

export const initCommand: Command = {
  name: 'init',
  summary: 'Create a new weekspan file',
  usage: 'weekspan init [path]',
  run: (ctx) => runInit(ctx),
}
