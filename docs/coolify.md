# Coolify Deployment

Automaker ships with a multi-service Docker setup (UI + API). Coolify can deploy this using the provided `docker-compose.coolify.yml`.

## Quick Setup

1. Create a new Coolify application using Docker Compose.
2. Point it to `docker-compose.coolify.yml`.
3. Configure two services:
   - `ui` service port: `80`
   - `server` service port: `3008`

## Required Environment Variables (Coolify)

- `ANTHROPIC_API_KEY` (required unless you plan to auth via Claude CLI inside the container)
- `VITE_SERVER_URL` (public API URL, used at build time by the UI)
- `CORS_ORIGIN` (public UI URL, used at runtime by the API)

## Recommended Values

If you use two subdomains:

- `VITE_SERVER_URL=https://api.example.com`
- `CORS_ORIGIN=https://app.example.com`

If you allow multiple UI origins, provide a comma-separated list in `CORS_ORIGIN`.

## Optional Environment Variables

- `AUTOMAKER_API_KEY` (locks down the API with `X-API-Key`)
- `OPENAI_API_KEY`, `CURSOR_API_KEY`
- `ALLOWED_ROOT_DIRECTORY=/projects` (recommended for isolation)

## Notes

- The UI build uses `VITE_SERVER_URL` at build time. If you change it, you must rebuild the UI image.
- Data is persisted in named Docker volumes (`automaker-data`, `automaker-claude-config`, `automaker-cursor-config`).
