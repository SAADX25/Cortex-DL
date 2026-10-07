# Cortex DL 2.1.6

- New URL analysis resets the previous video's quality selection. Best Auto shows the highest available resolution; a quality selected while analysis is running remains selected.
- Windows installer upgrade validation follows the package version instead of a hardcoded 2.1.5 path.
- The historical 2.1.0 installer currently returns HTTP 404. When unavailable, CI tests current installation/reinstallation and reports it explicitly. Other network errors remain failures. Installer tests refuse to replace an existing real installation or profile.
- Release validation inspects the actual packaged ASAR and resources for redistributed engine binaries and verifies shipped third-party notices. Bundled engines still require the corresponding-source review; this installer downloads engines separately on first launch.
- GitHub publishes the installer, blockmap and update manifest from the successful Windows validation job rather than rebuilding an untested installer in the release job.

Local validation: TypeScript, ESLint, release version checks, 87 regression tests and 17 targeted quality/production/release tests passed. Production dependency audit reported zero known vulnerabilities. Final installer and remote workflow results are recorded with the published release.

Windows x64. Internet access is required for first-run engine provisioning and downloads. The installer is unsigned; no signing certificate is configured. Fixture coverage does not guarantee every external provider or every Windows/GPU configuration.
