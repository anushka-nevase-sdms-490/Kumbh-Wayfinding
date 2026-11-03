#!/usr/bin/env bash
# Nightly database backup (run from cron on the server), kept 14 days.
#   0 2 * * * /opt/setu/deploy/backup.sh >> /var/log/setu-backup.log 2>&1
# Copy the backups folder off the server too (e.g. rclone to cloud storage).
# Packs and the offline map are rebuilt from the database / repo: not backed up.
# The OSM answers (setu_osm volume) can be downloaded again with scripts/import_osm.py.
set -euo pipefail
cd "$(dirname "$0")"
# Dumps hold PIN hashes, SOS positions and cases: readable by this user only.
umask 077
mkdir -p backups
file="backups/setu-$(date +%F-%H%M).dump"
# Write to a temporary name first: a failed dump never looks like the newest backup.
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U setu -Fc setu > "$tmp"
[[ -s "$tmp" ]] || { echo "$(date -Is) backup FAILED: empty dump" >&2; exit 1; }
mv "$tmp" "$file"
find backups -name 'setu-*.dump' -mtime +14 -delete
echo "$(date -Is) backup $file ($(du -h "$file" | cut -f1))"
