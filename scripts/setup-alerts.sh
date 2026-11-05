#!/bin/bash
set -e

CONTAINER="pradomotica-app-1"
SECRET=$(docker exec "$CONTAINER" printenv CAMERA_WEBHOOK_SECRET)
APP_URL=$(docker exec "$CONTAINER" printenv APP_URL)

echo "=== Non-tablet cameras ==="
docker exec pradomotica-postgres-1 psql -U avyra -d avyra -t -A -c "
  SELECT d.id, d.name
  FROM devices d
  JOIN cameras c ON c.device_id = d.id
  WHERE d.enabled = true
    AND (c.model IS NULL OR c.model != 'Tablet')
  ORDER BY d.created_at;
" | while IFS='|' read -r device_id device_name; do
  [ -z "$device_id" ] && continue
  hmac=$(echo -n "$device_id" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
  echo ""
  echo "Camera: $device_name"
  echo "  ID: $device_id"
  echo "  Motion URL: $APP_URL/api/cameras/$device_id/motion?type=motion&token=$hmac"
  echo "  Sound URL:  $APP_URL/api/cameras/$device_id/motion?type=sound&token=$hmac"
done
