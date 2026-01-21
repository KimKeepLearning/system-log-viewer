# System Log Viewer

An efficient and powerful desktop application designed solely for viewing and analyzing ChromeOS system logs. Built with modern web technologies and wrapped in Electron for a native experience.

## Features

- **📂 Multi-Format Support**: Drag and drop `.txt`, `.log`, files or even full `.zip` log archives directly into the viewer.
- **🚀 High Performance**: optimized for large log files using virtualization rendering (handling 100k+ lines smoothly).
- **🔍 Advanced Search**: Real-time search with Regular Expression (Regex) support to quickly find exactly what you're looking for.
- **🔗 Smart Merging**: "Merge with timestamp" feature automatically interleaves logs from different sections based on time, helping you correlate events across different subsystems.
- **📊 Structured Navigation**: Automatically parses log dumps into a navigable sidebar structure, separating content by file and section.

## Tech Stack

This project is built using a modern, robust stack:

- **Core**: [Electron](https://www.electronjs.org/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Electron Vite](https://electron-vite.org/)
- **UI/Styling**: [Tailwind CSS](https://tailwindcss.com/) & [Shadcn UI](https://ui.shadcn.com/)
- **State Management**: [Jotai](https://jotai.org/)
- **Routing**: [TanStack Router](https://tanstack.com/router)
- **Virtualization**: [React Virtuoso](https://virtuoso.dev/)

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/KimKeepLearning/system-log-viewer.git
   cd system-log-viewer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## Building for Production

To create an executable for your operating system:

```bash
# General build
npm run build

# Create distributables (Installers)
npm run make

# Platform specific
npm run make:win   # Windows
npm run make:mac   # macOS
npm run make:linux # Linux
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)