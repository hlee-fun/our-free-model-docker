# our-free-model-docker

[简体中文](README.md) | **English**

Packages the **standalone** mode of [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) into a Docker container **as-is**, so that it **can be used directly by other devices on the same LAN**.

> **Disclaimer**: this project only **repackages the upstream code into a container, unmodified**. The features, content, models and service quality of the upstream project are **not related to the author of this repository**; all copyright and responsibility belong to the original author. This repository contains no upstream source code and makes no changes to its content.
>
> **No content changes**: the upstream code is used verbatim (shallow-cloned at build time and packaged). Only three minimal patches are applied, all of which fall back to upstream behaviour when their respective env var is unset (so they are not functional changes):
> - `docker/patch-trust.mjs` adds an `OFM_TRUSTED_HOSTS` switch to `src/trust.js` to let the LAN Host fence pass (otherwise the management UI returns `403`);
> - `docker/patch-baseurl.mjs` makes `/api/management/summary` rewrite `baseUrl` based on the **actual request Host header**, fixing the LAN issue where the frontend received a hardcoded `127.0.0.1` base URL and routed its API calls / redirects back to the visitor's own loopback (the address is auto-detected, never hard-coded).
> - `docker/patch-lan-login.mjs` makes the "add account" login flows under the EAC router (the temporary OAuth callback servers, e.g. Loomy WeChat / Trae / LobsterAI / Raccoon / Carrier) use `OFM_LAN_IP` for both their bind address and the callback URL they show, fixing the LAN issue where the browser opened `http://127.0.0.1:<port>/...` and pointed at its own loopback instead of the host (falls back to upstream behaviour exactly when `OFM_LAN_IP` is unset).
> `socat` is an extra component inside the image and does not modify upstream code either.

## Upstream attribution

| Item | Value |
|------|-------|
| Project | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| Author | **Ebony-Vinyl** |
| License | **MIT** |
| Upstream version used | `2.8.0` (image `ghcr.io/hlee-fun/our-free-model:latest`) |

When redistributing the image you must keep the upstream `LICENSE` and the third-party notices (`vendor/channel-pack/`, `vendor/magpie/`, `scripts/standalone-third-party.txt`).

## Why the LAN matters (the point of this container)

Upstream **restricts the management UI to the local machine** (the management port is hard-bound to `127.0.0.1`, there is no `--host`; see upstream issue #216). This image solves that, so **any device on the same LAN** can use it:

| Purpose | LAN address | Who uses it | Auth |
|---------|-------------|-------------|------|
| **Gateway** | `http://<HOST_IP>:18901/v1` | Any OpenAI-compatible client / the original dsh on the LAN | `Authorization: Bearer <LAN Key>` |
| **Management UI** | `http://<HOST_IP>:18900` | A browser on any LAN device | Paste the **Management Key** into the "token" field |

- **Gateway**: upstream already listens on `0.0.0.0`, so it is reachable from the LAN out of the box once containerised.
- **Management UI**: upstream binds to loopback only, so LAN devices get `10061`; this image relays it per LAN IP **auto-detected via `hostname -I`** (not hard-coded) with `socat`, and whitelists it through `OFM_TRUSTED_HOSTS` to pass the upstream Host fence (otherwise `403`); `patch-baseurl.mjs` additionally rewrites the management API base URL to match the address the visitor used, so the frontend no longer sends its API calls / redirects back to the visitor's own `127.0.0.1` — **this is the main enhancement over the original project**.
- **EAC router "add account" login**: when adding accounts for channels (Loomy WeChat / Trae / LobsterAI / Raccoon / Carrier, etc.) in the management UI, upstream starts a temporary OAuth callback server on the host and hard-codes its callback address as `http://127.0.0.1:<random port>/...`. A LAN device's browser opening that link points at its own loopback and cannot reach the host, so login fails. `patch-lan-login.mjs` makes both the bind address and the callback URL use `OFM_LAN_IP` (auto-detected by the entrypoint as the host's primary LAN IPv4, or set by you manually), so LAN devices can complete the login. **The address is auto-detected, never hard-coded.**
- The two keys are **not interchangeable**: the LAN Key is only for the gateway on `18901`, the Management Key only for logging into `18900`. Both live in `/data/settings.json` (`standaloneLanKey` / `managementKey`).
- The ports above are defaults; override them with `OFM_ADMIN_PORT` / `OFM_LAN_PORT`.

## Usage (Docker Compose)

Pulls the image remotely, no local build, no local file dependencies (data lives in the named volume `ofm-data`).

```sh
# The image is already set in docker-compose.yml (override with OFM_IMAGE=<image>)
docker compose up -d
docker compose logs -f ofm   # login link / whitelisted LAN hosts
docker compose down          # stop (volume is kept)
```

## First run: get your own two keys

**The image contains no keys** (`/data` is a volume; keys are generated randomly on first start), so **every deployment has different keys that exist only inside your own container**:

- distributing the image **cannot** leak keys;
- and the author **cannot** tell you the values in advance — read them after your own container starts.

```sh
# Option 1: one-time management login link (valid for 10 minutes, single use)
docker compose logs ofm | grep -i login

# Option 2: read them directly (most reliable, works any time)
docker exec ofm node -e 'const j=JSON.parse(require("fs").readFileSync("/data/settings.json","utf8"));console.log("LAN Key:",j.standaloneLanKey);console.log("Management Key:",j.managementKey)'
```

The LAN Key can also be viewed / rotated in the management UI under "API access". The Management Key has no rotation endpoint; if you need to change it, edit `/data/settings.json` (stop the container, rewrite it as root; the value must be non-empty and different from `forwardKey`, otherwise it is regenerated).

> Once the service is exposed, the keys are the only authentication: rotate the LAN Key regularly and avoid exposing the management UI on `18900` directly to the public internet.

## Environment variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `OUR_FREE_MODEL_FREE_TRANSPORT` | `node` | Without Bun in the container, inference returns 502; this restores the legacy transport |
| `OFM_TRUSTED_HOSTS` | auto-detected | Hosts allowed to open the management UI; set the host IP manually on a bridge network |
| `OFM_LAN_IP` | auto-detected (first non-docker-bridge LAN IPv4) | LAN primary IP used for EAC router "add account" login callbacks; set manually to override auto-detection (e.g. multi-NIC) |
| `OFM_ADMIN_PORT` / `OFM_LAN_PORT` | `18900` / `18901` | Management port / gateway port |

## Notes

- The free-tier quota is controlled by upstream (it may return `429 Free usage limit reached`); unrelated to containerisation.
- **The footer showing version `2.7.1` is an upstream leftover**: the upstream root `package.json` is already `2.8.0`, but the sub-package `packages/standalone/package.json`'s `version` field was not bumped on release (still `2.7.1`), and the management UI footer reads that sub-package version. This is the original author's unsynced source, **not a bug in this image, and intentionally left unchanged** (this repository adheres to "repackaging as-is" and does not modify upstream content).
- **"Magpie engine binary is unavailable" in the model workbench is an upstream limitation**: the upstream `vendor/magpie/engine.json` only ships the `win32-x64` engine binary, so under a Linux container (including this image) `status().available` is always `false` and the Magpie engine shows as unavailable. **This is an upstream platform-support scope issue, not caused by containerisation**; this repository adheres to "repackaging as-is" and does not compile or inject any binaries, so it will not work around that limitation. To use Magpie, run the upstream original directly on a Windows host.
- The `PLAN.md` and local test files of this repository are not committed; they exist only in the local working copy.
