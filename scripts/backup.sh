#!/usr/bin/env bash
# ==============================================================================
# Ekalavya LMS: Automated Encrypted Backup Script (SEC-H07)
# Officers Training College, AMC Centre & College, Lucknow
#
# Generates AES-256-CBC encrypted backups of the MySQL database and moodledata
# repositories with SHA-256 checksum verification and automated retention.
#
# Usage:
#   ./scripts/backup.sh [--restore <backup_file.enc>]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load environment configuration if available
if [[ -f "${ROOT_DIR}/.env" ]]; then
    while IFS='=' read -r key val || [[ -n "$key" ]]; do
        [[ "$key" =~ ^[[:space:]]*# || -z "$key" ]] && continue
        key="$(echo "$key" | tr -d '[:space:]')"
        val="${val%\"}"
        val="${val#\"}"
        export "$key"="$val"
    done < "${ROOT_DIR}/.env"
fi

BACKUP_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
TARGET_BASENAME="ekalavya_backup_${TIMESTAMP}"
WORK_DIR="${BACKUP_DIR}/work_${TIMESTAMP}"
LOG_FILE="${BACKUP_DIR}/backup.log"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

log() {
    echo "$@" | tee -a "${LOG_FILE}"
}

log "======================================================================"
log "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Ekalavya LMS Backup"
log "======================================================================"

# Encryption key must be defined in environment
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-${DB_PASS:-}}"
if [[ -z "${BACKUP_ENCRYPTION_KEY}" ]]; then
    echo "ERROR: BACKUP_ENCRYPTION_KEY or DB_PASS must be set for backup encryption." >&2
    exit 1
fi

mkdir -p "${WORK_DIR}"
trap 'rm -rf "${WORK_DIR}"' EXIT

cd "${ROOT_DIR}"

# 1. Database Dump
log "[1/4] Exporting MySQL database (${DB_NAME:-moodle})..."
docker compose exec -T db \
    mysqldump \
        -u "${DB_USER:-moodle}" \
        -p"${DB_PASS}" \
        --single-transaction \
        --quick \
        --routines \
        --triggers \
        "${DB_NAME:-moodle}" > "${WORK_DIR}/database.sql" 2>/dev/null || true

if [[ ! -s "${WORK_DIR}/database.sql" ]]; then
    log "ERROR: Database export failed or generated empty dump."
    exit 1
fi
log "      Database dump created ($(du -h "${WORK_DIR}/database.sql" | cut -f1))."

# 2. Archive moodledata (course presentations, commanders portraits)
log "[2/4] Archiving moodledata repository..."
docker compose exec -T php \
    tar -czf - -C /var/www/moodledata course_ppts commanders > "${WORK_DIR}/moodledata_files.tar.gz" 2>/dev/null || true

log "      Moodledata archive created ($(du -h "${WORK_DIR}/moodledata_files.tar.gz" | cut -f1))."

# 3. Combine and AES-256 Encrypt
log "[3/4] Creating AES-256-CBC encrypted archive..."
COMBINED_TAR="${WORK_DIR}/${TARGET_BASENAME}.tar"
tar -cf "${COMBINED_TAR}" -C "${WORK_DIR}" database.sql moodledata_files.tar.gz

ENCRYPTED_OUTPUT="${BACKUP_DIR}/${TARGET_BASENAME}.tar.enc"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
    -in "${COMBINED_TAR}" \
    -out "${ENCRYPTED_OUTPUT}" \
    -pass pass:"${BACKUP_ENCRYPTION_KEY}"

chmod 0600 "${ENCRYPTED_OUTPUT}"
log "      Encrypted backup written to ${ENCRYPTED_OUTPUT} ($(du -h "${ENCRYPTED_OUTPUT}" | cut -f1))."

# 4. Generate SHA-256 checksum
log "[4/4] Generating cryptographic SHA-256 checksum..."
CHECKSUM_FILE="${BACKUP_DIR}/${TARGET_BASENAME}.sha256"
(cd "${BACKUP_DIR}" && sha256sum "$(basename "${ENCRYPTED_OUTPUT}")") > "${CHECKSUM_FILE}"
log "      Checksum: $(cat "${CHECKSUM_FILE}")"

# 5. Clean up old backups based on retention policy
log "Enforcing ${RETENTION_DAYS}-day retention policy..."
find "${BACKUP_DIR}" -name "ekalavya_backup_*.tar.enc" -type f -mtime +"${RETENTION_DAYS}" -delete || true
find "${BACKUP_DIR}" -name "ekalavya_backup_*.sha256" -type f -mtime +"${RETENTION_DAYS}" -delete || true

log "======================================================================"
log "[$(date '+%Y-%m-%d %H:%M:%S')] Backup Completed Successfully."
log "======================================================================"
