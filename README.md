# Shayan's Sons Proxy

A fixed-origin, authenticated reverse proxy for `https://web.cloudmoonapp.com`. It forwards HTTP requests and WebSocket upgrades, preserves Cloudmoon's root-relative game-player redirects, rewrites browser origins for upstream session checks, streams request and response bodies, and rejects attempts to proxy another origin.

## Run in Node

Requires Node.js 20 or newer. No npm dependencies or manual configuration are needed.

```sh
npm run build
npm start
```

The server listens on `0.0.0.0:8080`. Open `/` to sign in and choose a destination from the welcome screen, `/hub` for the game hub, `/cloudmoon/` for the Cloudmoon reverse proxy, or `/healthz` for the unauthenticated health check. Login uses an eight-hour signed session cookie; no browser Basic Auth prompt is used. Set `PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD`, or `PROXY_SESSION_SECRET` to override the defaults.

## Use from a Fork in Codespaces

1. Fork this repository to your GitHub account.
2. From your fork, select **Code**, then **Create codespace on main**.
3. In the Codespace terminal, run:

	```sh
	npm run build
	npm start
	```

4. Codespaces forwards port `8080` and opens the Game Hub. Sign in with the defaults below, then choose Cloudmoon or Boosteroid.

Each friend runs an independent copy in their own fork and Codespace. The forwarded port is private by default. If starting the server reports that port `8080` is already in use, stop the earlier `npm start` process in its terminal before starting it again.

## Run with Docker

```sh
docker compose up --build -d
```

The container runs as a non-root user, drops Linux capabilities, and restarts automatically. Set `PROXY_PORT` to change the host port. Compose uses the same default login unless `PROXY_USERNAME` and `PROXY_PASSWORD` are set in its environment.

## Access

Open the forwarded port 8080 in Codespaces and sign in through the page with:

- Username: `shayan daddy`
- Password: `iamshayansson`

These are shared defaults embedded in the repository and are not secrets. Anyone with repository access can read them. Change both values before exposing this proxy beyond a trusted Codespace or network. Use a private Codespaces port unless you intentionally want to share access.