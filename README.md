# Eden

A powerful browser exploitation and simulation framework for red team assessments and security training. Eden helps you stage realistic modern web attack scenarios with Browser‑in‑the‑Browser (BitB) flows, dynamic permission prompts (camera, microphone, clipboard, screen, location), and real‑time multi‑client management over WebSockets.

> Disclaimer:
Use Eden only in environments where you have explicit authorization. Unauthorized use against systems, networks, or individuals is strictly prohibited. Ensure that all activities are conducted with proper consent and in full compliance with applicable laws, regulations, and organizational policies. You are solely responsible for your actions and their consequences.


## Highlights

- **Realistic simulations**: BitB flows, dynamic permission requests, and in‑browser interaction capture
- **Multi‑client control**: Manage many clients simultaneously with a WebSocket relay and queues
- **Rich telemetry**: Capture camera frames, screen frames, mic audio data, mouse positions, clicks, clipboard, and basic system info
- **Operator UI**: Browser UI for viewing content, windows management, logs, and responses
- **Simple auth**: Token‑based session API with credential update support
- **Self‑contained server**: Express + `ws`, static hosting, and optional PHP file execution
- **One‑click Windows setup**: `startup.py` bootstraps Node.js, installs packages, updates URLs, and can expose via ngrok


## Project Structure

- `server.js`: Express/WS server, auth endpoints, static hosting, PHP bridge, and real‑time relay
- `server.html`: Operator panel UI container that loads the client logic
- `eden.js`: Core client logic for capture, UI windows, content delivery, BitB flows, and messaging
- `login.html`: Simple login page to obtain a session token for the operator UI
- `startup.py`: Windows helper/launcher for installing dependencies, configuring, and running the server (and optionally ngrok)


## Features

- **Dynamic permission capture**: Camera, microphone, screen, clipboard, and location requests on demand
- **Media streaming**: Periodic camera/screen frames and mic audio relayed to other clients/operators
- **Clipboard streaming**: Request clipboard snapshots and monitor changes
- **Interaction tracking**: Mouse position, clicks (incl. long click variants), and selected element information
- **Content delivery**: Push HTML/JS content to client windows, with restore/cleanup, download support, and window state persistence
- **Multi‑client queues**: Per‑client message queues (camera, screen, other) with priority handling
- **Operator coordination**: Target specific clients or broadcast; high‑priority responses bypass queues
- **Authentication API**: Login, token verification, logout, and credential updates with session expiry


## Requirements

- Windows 10/11 (tested path: PowerShell)
- Python 3.8+
- Internet access (for optional ngrok exposure)
- Node.js + npm (installed automatically by `startup.py` if missing)
- Optional: PHP in PATH if you plan to serve/execute `.php` files via the middleware


## Quick Start (Windows)

1) Clone the repository

```powershell
git clone https://github.com/Mr-pentest/Eden.git
cd eden
```

2) Run the Windows bootstrapper (recommended)

```powershell
python .\startup.py
```

- Installs Node.js if needed and required npm modules
- Can configure WebSocket/HTTP URLs (local or ngrok)
- Starts the Node server on port 8080
- Provides a small operator menu (start/stop, link preview helpers, etc.)

3) Open the operator UI

- Local: `http://localhost:8080/server.html`
- Login page: `http://localhost:8080/login.html`

4) Share the client link

- Send the hosted URL (e.g., via ngrok if enabled) to test participants/targets within your authorized scope


## Manual Start (alternative)

If you prefer to run without the Python helper:

```powershell
npm install
node server.js
```

Then open `http://localhost:8080/server.html` (and `login.html` to log in).


## Authentication

- **Default credentials**: `Eden` / `Eden` (changed via API or by editing `auth_config.json`)
- **How to log in**: Open `login.html`, enter credentials, receive a token, and proceed to `server.html`
- **Endpoints (brief)**: `/login`, `/verify-token`, `/logout`, `/update-credentials`
- **Credential file format** (`auth_config.json` in project root):

```json
{
  "username": "Eden",
  "password": "Eden"
}
```


## Server Overview

- Serves static files from the project directory
- WebSockets via `ws` on the same HTTP server (port 8080 by default)
- Per‑connection queues for `camera`, `screen`, and `other` messages
- Priority paths for specific message types (e.g., `audio-data`, `tracking-control`, high‑priority `refreshResponse`)
- Optional PHP handler: Requests ending in `.php` will be executed via a local `php` process and the output returned


## Operator Workflow

1) Log in at `login.html` to obtain a token
2) Open `server.html` (operator panel) to manage connected clients
3) Use Eden UI (driven by `eden.js`) to:
   - Request permissions (camera/mic/screen/clipboard/location)
   - View streamed frames/audio
   - Send content to display in client windows (with window controls)
   - Save/restore pushed content and clear storage
   - Target specific client IDs or broadcast
   - Monitor logs and statuses per client


## Configuration

- **Port**: Default `8080` (see `server.js`)
- **Credentials**: Managed via `auth_config.json` (see Authentication section for example format)
- **Public exposure**: Use `startup.py` to configure and run ngrok; it will update WebSocket and HTTP URLs in relevant files
- **PHP execution**: Requires `php` in PATH; otherwise `.php` requests will fail with 500


## Troubleshooting

- Port in use: Stop existing processes on 8080 or change the port in `server.js`
- WebSocket not connecting: Ensure URLs are updated if using ngrok; verify network egress rules
- Media permissions denied: Users must approve permissions in their browser; some contexts (iframes, http vs https) may block access
- Clipboard access: Modern browsers restrict clipboard APIs. Eden implements polling and request patterns, but user gestures or permissions may still be required
- Antivirus/EDR: Real‑time protection may interfere with certain features or ngrok connections. Use only within authorized test environments


## Safety & Legal

- Eden is intended for security training and authorized red team assessments only
- You must obtain explicit, written permission from system owners before use
- Review and comply with all applicable laws and organizational policies
- Do not target or collect data from unintended users


## Contributing

Contributions are welcome. Please open issues or PRs with clear descriptions and testing notes.


## License

Specify your preferred license here (e.g., MIT). 
