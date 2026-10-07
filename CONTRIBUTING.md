# Contributing to Cortex DL

Cortex DL is an Electron, React and TypeScript desktop app. Development and release validation target Windows x64 and Node.js 24.

## Setup

Install Git and Node.js 24, then clone your fork:

```powershell
git clone https://github.com/YOUR_USERNAME/Cortex-DL.git
cd Cortex-DL
npm run setup
npm run dev
```

`npm run setup` installs the locked dependencies in `app`. The first development startup stages the pinned media engines and needs internet access. Keep `app/engine-baseline` and its cached downloads for later offline development. `Cortex_Dev.bat` also starts development after setup.

The root npm commands forward to the package in `app`. You can run app-specific commands directly from that folder.

## Adding a feature

See [the development guide](app/docs/development.md) for the module map, extension points and validation workflow. Follow the existing component, store and service boundaries. Update shared types and both Arabic and English translations when a feature changes the renderer contract or visible UI text.

For download changes, preserve attempt ownership, cancellation, pause/resume and final-file validation. Add regression coverage for the behavior you change. Read [the downloader lifecycle guide](app/docs/downloader-core-v2.md) before changing execution or recovery.

## Validation

From the repository root:

```powershell
npm run check
```

This runs TypeScript, ESLint and the full regression suite. Tests using actual media tools need the staged engines. If they are absent, run `npm run engines:stage` from `app` first.

For packaging, installer or release changes, run from `app` on Windows:

```powershell
npm run build
npm run test:packaged
npm run test:installer
npm run release:verify
```

The installer test requires an isolated Windows user without an existing Cortex DL installation or application data. The production validation workflow defines the complete release checks.

## Cleaning generated output

Stop development and test processes, then run from the root:

```powershell
npm run clean:preview
npm run clean
```

`npm run clean:packaged` also removes generated `win-unpacked` directories under versioned releases. Rebuild before running packaged tests or release artifact verification afterward. Source, installer source, dependencies, development engines, release installers, `.env` and `.cortex_temp` are preserved.

## Pull requests

Use a focused branch and describe the behavior that changes, the reason and the validation performed. Keep generated output, credentials and downloaded media out of commits. Include screenshots for visible UI changes. Follow the existing pull request template and [code of conduct](CODE_OF_CONDUCT.md).
