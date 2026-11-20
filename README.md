<p align="center">
  <img src="assets/logo.png" alt="Cortex DL" width="84" />
</p>

<h1 align="center">Cortex DL</h1>

<p align="center">
  Fast, modern Windows desktop downloader for video, audio, local media, and AI subtitles.
</p>

<p align="center">
  <a href="https://github.com/SAADX25/Cortex-DL/actions/workflows/validation.yml">
    <img src="https://github.com/SAADX25/Cortex-DL/actions/workflows/validation.yml/badge.svg?branch=master" alt="Build" />
  </a>
  <a href="https://github.com/SAADX25/Cortex-DL/releases/latest">
    <img src="https://img.shields.io/github/v/release/SAADX25/Cortex-DL" alt="Latest Release" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D6" alt="Windows x64" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/SAADX25/Cortex-DL/releases/latest">Download</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

## Features

- **Multi-Platform Downloads** — YouTube, YouTube Music, Threads, Instagram, Facebook, Reddit, X, TikTok, Kick, HLS streams, and direct links.
- **Full Format & Quality Control** — Select resolutions, convert video/audio formats, trim visually, and queue playlists or batches with pause/resume.
- **Built-In Media Player & Library** — Play files in-app or in a floating window, edit embedded cover artwork, and organize local media.
- **Local Subtitles Studio** — Generate, translate, review, export, and embed subtitles offline.
- **Bilingual UI** — Native English and Arabic (`RTL`) support.

## Development

Requires **Windows x64**, **Git**, and **Node.js 24**.

```powershell
git clone https://github.com/SAADX25/Cortex-DL.git
cd Cortex-DL
npm run setup
npm run dev
```

| Command | Description |
| --- | --- |
| `npm run dev` | Run Vite + Electron in development mode |
| `npm run check` | Run TypeScript, ESLint, and full test suite |
| `npm run build` | Build the Windows installer |

## License

Licensed under the [MIT License](LICENSE). Third-party engines and models retain their respective licenses.
