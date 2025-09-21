# Trade Scope Extension

Modern Chrome extension scaffold powered by Vite and the CRX plugin.

## Getting Started

1. Install dependencies:
   ```sh
   pnpm install
   ```
2. Start the hot-reload dev server and load the generated extension from `.output/chrome-mv3` via **Load unpacked** in Chrome:
   ```sh
   pnpm dev
   ```
3. Run a production build, outputting to `dist/`:
   ```sh
   pnpm build
   ```
4. Execute unit tests:
   ```sh
   pnpm test
   ```

## Project Structure

- `public/manifest.json` – Chrome Manifest V3 definition
- `src/popup.html` / `src/popup/main.ts` - popup entry point (hello world UI)
- `src/background.ts` – background service worker entry
- `vite.config.mts` – Vite + CRX configuration
- `vitest.config.mts` – Vitest configuration (jsdom, coverage)

## Git Hooks (Optional)

Configure linting or formatting hooks later with tools like Husky if desired.
