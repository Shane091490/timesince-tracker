# Time Since Tracker

A mobile-friendly habit tracker focused on *time elapsed since last completion*,
running as three Docker containers: **nginx** (static frontend + reverse proxy),
**app** (Node/Express API), and **db** (PostgreSQL).

## Stack

```
nginx (port 80) --serves static frontend, proxies /api/* --> app (port 3000) --> db (PostgreSQL 16)
```

- `frontend/index.html` — the entire UI: habit list, modals, heatmap, drag-reorder, themes. Talks to the backend only via `fetch('/api/...')`.
- `app/` — Express API: authentication (JWT in an httpOnly cookie), habit CRUD, completion logging, export/import, admin user management.
- `db/init.sql` — schema, auto-applied the first time the Postgres volume is created.

Data lives in PostgreSQL, in a named Docker volume (`db_data`) that survives container restarts and rebuilds.

## First-time setup on your Ubuntu server

1. Copy this whole `timesince-tracker/` directory to the server.
2. Create your environment file:
   ```bash
   cd timesince-tracker
   cp .env.example .env
   ```
3. Edit `.env` and set real values:
   - `POSTGRES_PASSWORD` — a strong password.
   - `JWT_SECRET` — a long random string, e.g. generate one with:
     ```bash
     openssl rand -base64 48
     ```
   - `HTTP_PORT` — the host port nginx should listen on (default `80`).
   - Leave `COOKIE_SECURE=false` unless nginx is terminating HTTPS for you (see below).
4. Build and start everything:
   ```bash
   docker compose up -d --build
   ```
5. Visit `http://<your-server>:<HTTP_PORT>/`. Register the **first account** — it automatically becomes the admin account. Everyone who registers afterward is a normal member.

Check status / logs:
```bash
docker compose ps
docker compose logs -f app
```

## Updating after you change code

```bash
docker compose up -d --build
```
This rebuilds only the `app` and `nginx` images (the frontend is baked into the nginx image); the `db` container and its data volume are untouched.

## Backing up / restoring the database

```bash
# Backup
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql

# Restore into a fresh volume
docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB" < backup.sql
```
(Values of `POSTGRES_USER`/`POSTGRES_DB` come from your `.env`.)

Per-user JSON export/import is also available from inside the app itself (Filters & settings → Data), useful for moving one person's habits between accounts or instances.

## HTTPS

This compose file serves plain HTTP on `HTTP_PORT`. For a server reachable from the internet, put a TLS-terminating reverse proxy in front of it (e.g. Caddy, or nginx with certbot on the host), and set `COOKIE_SECURE=true` in `.env` once traffic actually arrives over HTTPS — otherwise the login cookie won't be marked `Secure` and won't get the extra browser protection.

Note: installing the PWA to a home screen works over plain HTTP on `localhost`, but browsers require HTTPS for service workers/install prompts on any other host — so on a real server, PWA install won't offer itself until HTTPS is in front of it.

## Installing as an app (PWA)

The frontend is an installable Progressive Web App: `frontend/manifest.json` and `frontend/sw.js` define the app metadata/icons and a service worker that caches the static shell (`index.html`, icons, manifest) for instant loads and basic offline viewing. API requests are deliberately never cached or intercepted by the service worker, so habit data is always fetched live — offline just means the shell renders with a network error instead of stale data.

- **Chrome/Edge/Android**: an "Install app" button appears in Filters & settings → App once the browser decides the site is installable (valid manifest + icons + registered service worker + HTTPS/localhost).
- **iOS Safari**: there's no install-prompt API, so use Share → "Add to Home Screen" manually; the settings modal shows a hint for this on iOS.

If you change `frontend/index.html`, `manifest.json`, or `sw.js`, rebuild just the nginx image and bump `CACHE_NAME` in `sw.js` so already-installed clients pick up the new shell files instead of serving a stale cached version:
```bash
docker compose up -d --build nginx
```

## Notes on the app's design decisions

- **Auth**: username + password, bcrypt-hashed, JWT stored in an httpOnly, `SameSite=Lax` cookie — no client-side token handling needed, and it survives page reloads.
- **Multi-user data isolation**: every habit and completion row is scoped to a `user_id`; the API never returns another user's data. The admin role can only list/promote/demote/delete user *accounts*, not view other users' habit data.
- **All date/time math (elapsed time, calendar counts, streak period-index logic) runs client-side** in the browser's local timezone, since "today"/"this week" only make sense relative to the viewer's clock. The server just stores raw UTC timestamps.
- **Reordering** uses Pointer Events (not HTML5 drag-and-drop) so manual drag-to-reorder works reliably on iOS Safari, not just desktop browsers.

## Project layout

```
timesince-tracker/
├── docker-compose.yml
├── .env.example
├── db/
│   └── init.sql
├── app/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── src/
│       ├── db.js
│       ├── auth.js
│       ├── middleware/requireAuth.js
│       └── routes/{auth,habits,data,admin}.js
├── nginx/
│   ├── Dockerfile
│   └── default.conf
└── frontend/
    ├── index.html
    ├── manifest.json
    ├── sw.js
    └── icons/
        ├── icon-192.png
        ├── icon-512.png
        ├── icon-maskable-512.png
        ├── apple-touch-icon.png
        ├── favicon-32.png
        └── favicon-16.png
```
