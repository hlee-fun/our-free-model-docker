# our-free-model-docker

**English** | [简体中文](README.md)

Packages the **standalone** mode of [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) into a Docker container **as-is**, so that it **can be used directly by other devices on the same LAN**.

> **Disclaimer**: this project only **repackages the upstream code into a container, unmodified**. The features, content, models and service quality of the upstream project are **not related to the author of this repository**; all copyright and responsibility belong to the original author. This repository contains no upstream source code and makes no changes to its content.
>
> **No content changes**: the upstream code is used verbatim (shallow-cloned at build time and packaged). The single exception is `docker/patch-trust.mjs`, which adds a switch to `src/trust.js` that **only takes effect when `OFM_TRUSTED_HOSTS` is set** (with the variable unset the behaviour is byte-for-byte identical to upstream). `socat` is an extra component inside the image and does not modify upstream code either.

## Upstream attribution

| Item | Value |
|------|-------|
| Project | [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) |
| Author | **Ebony-Vinyl** |
| License | **MIT** |
| Upstream version used | `2.7.4` (image `ghcr.io/hlee-fun/our-free-model-v2.7.4:latest`) |

When redistributing the image you must keep the upstream `LICENSE` and the third-party notices (`vendor/channel-pack/`, `vendor/magpie/`, `scripts/standalone-third-party.txt`).

## Why the LAN matters (the point of this container)

Upstream **restricts the management UI to the local machine** (the management port is hard-bound to `127.0.0.1`, there is no `--host`; see upstream issue #216). This image solves that, so **any device on the same LAN** can use it:

| Purpose | LAN address | Who uses it | Auth |
|---------|-------------|-------------|------|
| **Gateway** | `http://<HOST_IP>:18901/v1` | Any OpenAI-compatible client / the original dsh on the LAN | `Authorization: Bearer <LAN Key>` |
| **Management UI** | `http://<HOST_IP>:18900` | A browser on any LAN device | Paste the **Management Key** into the "token" field |

- **Gateway**: upstream already listens on `0.0.0.0`, so it is reachable from the LAN out of the box once containerised.
- **Management UI**: upstream binds to loopback only, so LAN devices get `10061`; this image relays it per LAN IP with `socat` and whitelists it through `OFM_TRUSTED_HOSTS` to pass the upstream Host fence (otherwise `403`) — **this is the main enhancement over the original project**.
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
| `OFM_ADMIN_PORT` / `OFM_LAN_PORT` | `18900` / `18901` | Management port / gateway port |

## Notes

- The free-tier quota is controlled by upstream (it may return `429 Free usage limit reached`); unrelated to containerisation.
- The `PLAN.md` and local test files of this repository are not committed; they exist only in the local working copy.
