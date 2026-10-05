# Agent instructions

## Verify every change

Every change needs both of these checks. Neither one replaces the other.

1. **Unit tests**: run `npm test` (Vitest) and make sure every test passes. Add or update
   tests in `tests/` for the behavior you changed. Also run the type-checks and linting:
   - `npx tsc -p tsconfig.app.json --noEmit`
   - `npx tsc -p tsconfig.server.json --noEmit`
   - `npm run lint`
2. **On-website tests**: start the app with `npm run all` and use the affected feature in
   the browser to confirm it works there too.

## Releases and version numbers

C-Lux uses [semantic versioning](https://semver.org). The user decides when a release
happens and when a breaking change ships, so every version number change should mean
something to users.

- **Always ask the user before bumping any version**: the app version in `package.json`
  and every file version constant listed below. Never bump one on your own.
- Compatibility only matters between releases. Commits between two releases don't need
  to be compatible with each other.
- If a file version has already been bumped since the last release, don't bump it
  again. Fold your change into the unreleased version and its conversion step. If you
  can't tell whether a version was released, ask the user.

## JSON files must stay backwards-loadable

Any JSON file written by released version _x_ must load correctly in every later
version _y_ > _x_. Older versions do not need to load newer files; they should reject
them with a clear error.

Versioned files:

| File                    | Version constant                                       | Loader / converter                                                    |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| `scenes.json`           | `SCENES_FILE_VERSION` (`server/storage.ts`)            | `migrate` in `server/storage.ts`, using `shared/migrate.ts`           |
| Exported scene files    | `SCENE_EXPORT_VERSION` (`shared/patterns/patterns.ts`) | `Engine.importScene` in `server/engine.ts`, using `shared/migrate.ts` |
| `config.json`           | `CONFIG_FILE_VERSION` (`server/config.ts`)             | `configSchema` in `server/config.ts`                                  |
| `src/assets/names.json` | `version` field                                        | —                                                                     |

A file with no `version` field counts as version 1.

When a change affects what a stored file means, or what shape it has (for example, renamed
or removed fields, a parameter whose meaning or sign changes, or a new required field):

1. Ask the user before bumping the file's version (see above). If the current version
   hasn't been released yet, extend its step instead of adding a new one. For pattern
   data, adding a step to `STEPS` in `shared/migrate.ts` bumps `PATTERN_DATA_VERSION`
   automatically.
2. Write a converter that turns the previous version into the new one so that old files
   look and behave exactly as they did before. Never edit a step for a released version:
   a file must be able to go through every step from its own version up to the current
   one.
3. Make new fields optional with defaults that reproduce the old behavior, or fill them in
   during migration.
4. Update the files in the repository (`scenes.json`, `config.json`,
   `config.sample.json`) to the current version.
5. Add unit tests that load a file in the previous version and check the converted
   result, and keep the existing tests for older versions.
6. Whatever the UI sends to an import endpoint must carry the current version, so the
   server doesn't migrate it a second time.
