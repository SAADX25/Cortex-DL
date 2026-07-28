# Contributing to Cortex DL

Thank you for your interest in contributing to **Cortex DL**! We welcome all contributions, whether it's fixing bugs, proposing new features, improving documentation, or enhancing performance.

---

##  Getting Started

### Prerequisites
Before running the project locally, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)
- [Git](https://git-scm.com/)

---

## 📁 Project Structure

Here is a quick overview of how the codebase is organized:

* **`app/Front-End/`**: The React + TypeScript user interface built using Vite.
* **`app/Back-End/electron/`**: Electron main process handling IPC handlers, window management, and application life cycle.
* **`app/Back-End/electron/engines/`**: Core download engines including Direct, FFmpeg, and `yt-dlp` integration.

---

## 💻 Development Setup

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone [https://github.com/YOUR_USERNAME/Cortex-DL.git](https://github.com/YOUR_USERNAME/Cortex-DL.git)
   cd Cortex-DL
