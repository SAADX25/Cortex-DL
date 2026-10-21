# Contributing

Start with [local setup](README.md#run-locally), then use the [code map](app/docs/project-map.md) to find the files for your change. Development and release validation target Windows x64 and Node.js 24.

## Making a change

1. Keep the change focused and follow the existing module boundaries.
2. Update shared types and both interface languages when behavior changes.
3. Add regression coverage for changed behavior and describe what you checked.

The [development guide](app/docs/development.md) covers download ownership, cancellation, media validation and IPC. Keep filesystem, database and native-process work in the backend.

## Checks

Run from the repository root:

| Command | Checks |
| --- | --- |
| `npm run typecheck` | TypeScript contracts. |
| `npm run lint` | Source style and common errors. |
| `npm test` | All regression suites. |
| `npm run check` | All three checks above. |
| `npm run test:release` | Tag, version and Git hook safeguards. |

Tests that run media tools need `npm --prefix app run engines:stage` first. Keep `app/engine-baseline` for later runs.

For packaging changes, run these from `app`:

```powershell
npm run build
npm run test:installer
npm run release:verify
```

The installer test requires an isolated Windows user without an existing Cortex DL installation or profile. CI saves logs under `app/smoke-results` and uploads diagnostics separately from validated installer files.

## Release tags

A source update name such as `Update-107` is a commit label, not a new application version. Do not recreate `v2.2.0` for a source update. Existing release tags and published releases are immutable.

For an explicitly intended release:

1. Choose a version newer than published versions. Update `app/package.json` and both version fields in `app/package-lock.json`.
2. Run the read-only `npm run release:check`, finish validation, and commit the intended source changes.
3. From a clean checkout, run:

```powershell
npm run release:tag
npm --prefix app run release:build
npm run release:push
```

Tag creation checks local and remote duplicates, creates an annotated tag with a reflog, and never replaces an existing tag. The push command sends only that new tag. Remote inspection failures stop the operation.

A tag push triggers CI validation and the production release job, which uses the `production-release` environment. CI compares exact tag objects and target commits, then rejects an already-published release. Ordinary builds and Git synchronization do not create tags or publish releases.

`npm run setup` installs local tag guards. Existing checkouts can run `npm run git:hooks` once. The guards block local tag movement/deletion and validate direct Git or GUI tag pushes. Custom hooks are preserved for manual integration.

For a tag discrepancy, compare local and remote object IDs with the published release before any repair. Preserve the old object under a non-tag backup ref such as `refs/backups/tag-conflicts/...`. Any exception to the local guard needs an explicitly reviewed repair. Do not force-push, overwrite remote tags, or suppress the problem by disabling tag fetching.

## Cleanup and pull requests

Stop development and test processes before running `npm run clean:preview`, then `npm run clean`. Add `npm run clean:packaged` only when unpacked installer builds can be removed. Source, dependencies, staged engines, installers, `.env` and partial downloads are preserved.

A pull request should explain the behavior change, link the issue when relevant, and list validation results. Add screenshots for UI changes. Keep generated files, credentials and downloaded media out of commits, and follow the [code of conduct](CODE_OF_CONDUCT.md).
