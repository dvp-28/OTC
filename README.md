# Ekalavya LMS – local setup

Moodle for the Officers Training College, AMC Centre and College.
Runs on your laptop today and maps one-to-one onto the client's single
central server (4 VMs) later.

## What runs where

| Container | Becomes on the client server | Job |
|---|---|---|
| `proxy` | Proxy VM | TLS, security headers, WAF (Oct 14). The only thing the LAN can reach. |
| `web` + `php` + `cron` + `redis` | App VM | Moodle itself, scheduled tasks, sessions |
| `db` | Database VM | MySQL 8.4 |
| *(added later)* | Ops VM | Matomo, logs, backups |

The `app` and `data` networks are marked `internal`, so nothing can reach the
internet. If a feature breaks locally because it wants the internet, it will
break at the client site too, so fix it now.

## Moodle version

Moodle **5.3 is the next LTS** (supported to Oct 2029), due on **5 Oct 2026**.
Start on 5.2 today and switch the branch once 5.3 is out. Deliver on 5.3 LTS.

## Prerequisites

Docker (with Compose v2), Git, and [mkcert](https://github.com/FiloSottile/mkcert).

## First-time setup

```bash
# 1. Get Moodle (change to MOODLE_503_STABLE after 5 Oct)
git clone --depth 1 -b MOODLE_502_STABLE https://github.com/moodle/moodle.git moodle-src

# 2. Local HTTPS certificate
mkcert -install
mkcert -cert-file certs/ekalavya.crt -key-file certs/ekalavya.key ekalavya.local localhost 127.0.0.1
#    then add to your hosts file:   127.0.0.1  ekalavya.local

# 3. Settings
cp .env.example .env        # change every password

# 4. Start the stack
docker compose up -d --build

# 5. Install, harden, build the course structure
docker compose exec -u www-data php bash /opt/ekalavya/scripts/01-install.sh
docker compose exec -u www-data php bash /opt/ekalavya/scripts/02-harden.sh
docker compose exec -u www-data php php /opt/ekalavya/scripts/03-structure.php --batch=2026
```

Open https://ekalavya.local and log in as the Site Admin from `.env`.

## What the scripts create

- **Category tree:** OTC → Medical Officers (MOBC, MOJCC, MOSCC), Nursing
  Officers (BNOC, SNOC), Non-Technical (NTPCC, NT Adm)
- **Roles:**
  - *Institute Admin* – assigned on the OTC category; adds and deletes content
    in all courses and manages users, but cannot delete whole courses or
    reorganise categories.
  - *Course Admin* – assigned per course; adds and deletes content there only.
  - *Student* – Moodle's built-in role; view and attempt only.
  - *Site Admin* – hidden technical account for the tech team.
- **Cohorts:** one per course batch (e.g. `MOBC-2026`), auto-enrolled as Student.
- **Hardening:** forced login, no guests or self-signup, strong passwords and
  lockout, 30-minute session timeout, recycle bin, 365-day log retention,
  internet-calling features off.

All scripts are safe to re-run.

## Daily commands

```bash
docker compose logs -f php          # PHP errors
docker compose exec -u www-data php bash -c 'source /opt/ekalavya/scripts/common.sh; php $CLI/purge_caches.php'
docker compose down                 # stop (data is kept in volumes)
docker compose down -v              # stop AND wipe everything - fresh start
```

## Upgrading Moodle 5.2 → 5.3 LTS

```bash
cd moodle-src && git fetch --depth 1 origin MOODLE_503_STABLE && git checkout MOODLE_503_STABLE && cd ..
docker compose exec -u www-data php bash -c 'source /opt/ekalavya/scripts/common.sh; php $CLI/upgrade.php --non-interactive'
```

## Moving to the client server

1. Create 4 VMs on the host (Proxy, App, Database, Ops), each on its own
   virtual network segment. Only the Proxy VM gets an address on the LAN.
2. Copy this repository to each VM and run only that VM's services
   (or install the same components natively if containers are not permitted).
3. Change `.env`: `DB_HOST` and `REDIS_HOST` to the VM addresses,
   `MOODLE_WWWROOT` to the internal name, `MOODLE_DEBUG=0`.
4. Replace the mkcert certificate with one from the client's internal CA.

## Troubleshooting

- **Blank page or 404 on every URL:** your Moodle checkout has no `public/`
  folder (pre-5.1). Change `root` in `docker/web/moodle.conf` to `/var/www/moodle`.
- **"Database connection failed":** wait for the `db` health check
  (`docker compose ps`) and recheck `.env`.
- **Logged out on every click:** Redis password mismatch between `.env` and the
  running container; run `docker compose up -d --force-recreate redis php`.
- **Environment page warns about routing:** set `$CFG->routerconfigured = false`
  in `config/config.php` and report it so the nginx rule can be fixed.

## Next steps (per project plan)

- Oct 7 – branded theme (child of Boost)
- Oct 8–9 – JWT login plugin, including the Institute-admin IP allowlist
- Oct 12–13 – video pipeline and bulk upload script
- Oct 14 – ModSecurity WAF on the proxy
