# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A PDF viewer for Zed, ported from https://github.com/skrtk98/vscode-pdf-viewer. Zed's extension API has no webview or custom editor, so the viewer runs in a browser window, launched by a Zed task or by the Agent panel through the extension's MCP tool.

## Commands

Run in `viewer/`:

- `npm ci` then `npm run build`: bundle to `dist/` and `media/`
- `npm test`: all tests; `npx vitest run test/server.test.ts -t "<name>"` for one
- `npm run check`: type check

Run at the repository root:

- `cargo build --target wasm32-wasip2 --release`: build the extension
- `rustup target add wasm32-wasip2` if the target is missing

## Architecture

- `src/lib.rs` + `extension.toml`: the Zed extension. It only tells Zed how to start `mupdf-viewer mcp`.
- `viewer/src/cli.ts`: entry point. `launch.ts` forks a detached `serve` process so Zed tasks finish immediately; `target.ts` maps the argument to a PDF, because Zed cannot open a PDF in a buffer and `$ZED_FILE` is normally the document source.
- `viewer/src/server.ts`: replaces the VS Code extension host. It serves one PDF and the assets, and signals file changes over SSE. It exits when no browser window remains.
- `viewer/src/host.ts`: replaces the webview host in the browser. It defines `acquireVsCodeApi` and turns the viewer's messages into HTTP calls.
- `viewer/src/mcp.ts`: the `open_pdf` tool over stdio JSON-RPC.

Over SSH, Zed runs tasks on the remote machine and only forwards ports listed in advance, so `cli.ts` skips the browser and binds one of `REMOTE_PORTS` (`launch.ts`). The server checks the Host header against the bound port, so local and remote port numbers must match.

## Upstream code

`viewer/src/{viewer,worker,coords,raster}.ts`, `viewer/media/viewer.css`, and `viewer/test/{viewer.test,viewerHarness,worker.test,coords.test,raster.test}.ts` are unmodified upstream copies. Keep them that way so upstream fixes can be copied over: adapt behavior in `host.ts`, `server.ts`, or `viewer.html` instead. This is why `acquireVsCodeApi` and the `--vscode-*` CSS variables remain.

## Constraints

- The project is AGPL-3.0 because upstream and MuPDF are. Zed's extension registry does not accept AGPL, so it is distributed from GitHub.
- The extension ID must not contain "zed" or "extension" (Zed's naming rule).
- Unit tests cannot catch CSP, worker, or WASM loading failures. After changing `viewer.html`, `server.ts`, or `host.ts`, also check the viewer in a real browser.
