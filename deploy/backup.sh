#!/usr/bin/env bash
# Nightly database backup (run from cron on the server), kept 14 days.
#   0 2 * * * /opt/setu/deploy/backup.sh >> /var/log/setu-backup.log 2>&1
# Copy the backups folder off the server too (e.g. rclone to cloud storage).
# Packs and the offline map are rebuilt from the database / repo: not backed up.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/setu-$(date +%F-%H%M).dump"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U setu -Fc setu > "$file"
find backups -name 'setu-*.dump' -mtime +14 -delete
echo "$(date -Is) backup $file ($(du -h "$file" | cut -f1))"
