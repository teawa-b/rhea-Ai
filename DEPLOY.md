# Deploying Rhea on Railway

One Railway **project**, two **services** from the same GitHub repo:

| Service name | Root Directory | What it is | Local env template |
| --- | --- | --- | --- |
| `backend` | `backend` | Express API. Holds every secret (OpenAI, Jupiter, Pyth, Google). | [`backend/.env.example`](backend/.env.example) |
| `frontend` | `frontend` | Vite + React WebXR client, served as a static site | [`frontend/.env.example`](frontend/.env.example) |

The services find each other through Railway **reference variables**
(`${{ backend.RAILWAY_PUBLIC_DOMAIN }}`), so you never copy-paste URLs between them.
**Name the services exactly `backend` and `frontend`**, or change the names inside `${{ … }}` below to match.

---

## 1. Create the project and the backend service

1. **railway.com → New Project → Deploy from GitHub repo** → pick this repo.
   This creates the first service.
2. Click the service → **Settings**:
   - **Service name** (top of the page) → `backend`
   - **Source → Root Directory** → `backend`
   - **Networking → Generate Domain**
   - *(optional)* **Deploy → Healthcheck Path** → `/api/health`
   - *(optional)* **Source → Watch Paths** → `/backend/**`
   - Leave **Build Command** and **Start Command** empty. Railway runs `npm ci` and then `npm start`.
3. **Variables → Raw Editor** → paste this, fill in your keys → **Update Variables**:

   ```env
   OPENAI_API_KEY=
   OPENAI_LIVE_MODEL=gpt-live-1
   OPENAI_BACKEND_MODEL=gpt-5.6-terra
   OPENAI_LIVE_VOICE=marin
   CORS_ORIGIN=https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   JUPITER_API_KEY=
   PYTH_PRO_API_KEY=
   GOOGLE_MAPS_API_KEY=
   ```

   Do **not** add `PORT`. Railway sets it. Optional keys can stay empty.

## 2. Add the frontend service (same project)

1. In the project canvas: **+ Create → GitHub Repo** → the **same repo** again.
2. Click the new service → **Settings**:
   - **Service name** → `frontend`
   - **Source → Root Directory** → `frontend`
   - **Networking → Generate Domain**. This is the URL you open.
   - *(optional)* **Source → Watch Paths** → `/frontend/**`
   - Leave **Build Command** and **Start Command** empty. Railway builds with Vite and serves `dist/` as a static site.
3. **Variables → Raw Editor** → paste, fill in the Privy id → **Update Variables**:

   ```env
   VITE_API_URL=https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}
   VITE_PRIVY_APP_ID=
   ```

## 3. Deploy

1. Click **Deploy** on the staged-changes banner. Railway deploys both services.
2. Check `https://<backend domain>/api/health`. It should return `{"ok":true,...}`.
3. Open `https://<frontend domain>`.
4. **dashboard.privy.io → your app → Allowed origins** → add the frontend domain. Otherwise sign-in fails.

> **Order matters for one thing:** `VITE_API_URL` is baked into the frontend at build time. If the frontend
> built before the backend had a domain, just **Redeploy** the frontend. If it's still missing, the build
> fails on purpose and tells you what to set.

---

## Every variable at a glance

### `backend` service

| Variable | Required? | Value |
| --- | --- | --- |
| `OPENAI_API_KEY` | for voice | platform.openai.com |
| `OPENAI_LIVE_MODEL` | no | `gpt-live-1` |
| `OPENAI_BACKEND_MODEL` | no | `gpt-5.6-terra` |
| `OPENAI_LIVE_VOICE` | no | `marin` |
| `CORS_ORIGIN` | recommended | `https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}` (empty = allow any site) |
| `SOLANA_RPC_URL` | no | default public mainnet RPC |
| `JUPITER_API_KEY` | optional | real Trigger V2 orders, Swap V2 |
| `PYTH_PRO_API_KEY` | optional | real-time equity feeds; Yahoo fallback otherwise |
| `GOOGLE_MAPS_API_KEY` | optional | Street View images |

### `frontend` service

| Variable | Required? | Value |
| --- | --- | --- |
| `VITE_API_URL` | **yes** | `https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}` |
| `VITE_PRIVY_APP_ID` | for sign-in | your Privy app id (public, safe in the browser) |

**Never put secret keys on the frontend service.** Anything starting with `VITE_` ships to the browser.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Frontend build error: `VITE_API_URL is not set` / `has no domain` | Backend has no public domain yet, or the service isn't named `backend`. Fix it, then redeploy the frontend |
| Globe loads, no market data, console shows a `CORS` error | Service isn't named `frontend` (so `CORS_ORIGIN` resolves wrong), or clear `CORS_ORIGIN` on the backend |
| Requests go to `<frontend domain>/api/...` and 404 | `VITE_API_URL` was empty at build time. Set it and redeploy the frontend |
| Build uses the wrong files / "no start command" | Root Directory isn't set on that service |
| Voice errors "set OPENAI_API_KEY" | Add it on the **backend** service |
| Sign-in popup fails | Add the frontend domain to Privy's allowed origins |

## Local development

```bash
npm run install:all                      # root helper + backend/ + frontend/
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env   # leave VITE_API_URL empty locally
npm run dev                              # backend :5050 + frontend http://localhost:3000 (proxies /api)
```

Or run `npm run dev` inside `backend/` and inside `frontend/` in two terminals.

`frontend/shared/` and `backend/shared/` hold copies of `registry.ts` and `types.ts`. If you edit one, copy it to the other folder.
