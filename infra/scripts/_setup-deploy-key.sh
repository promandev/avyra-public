#!/bin/bash
# Sets up the restricted deploy key in authorized_keys
# Run once on the server: bash /tmp/_setup-deploy-key.sh

DEPLOY_SCRIPT="/home/youruser/deploy-app.sh"
KEY_FILE="/home/youruser/.ssh/github-deploy-key.pub"
AUTH_KEYS="/home/youruser/.ssh/authorized_keys"

if [ ! -f "$KEY_FILE" ]; then
  echo "ERROR: $KEY_FILE not found"
  exit 1
fi

PUBKEY=$(cat "$KEY_FILE")
ENTRY="command=\"$DEPLOY_SCRIPT\",no-pty,no-agent-forwarding,no-X11-forwarding,no-port-forwarding $PUBKEY"

# Remove any broken/empty lines related to previous attempts
sed -i '/^\\$/d' "$AUTH_KEYS" 2>/dev/null || true
sed -i '/^$/d' "$AUTH_KEYS" 2>/dev/null || true

if grep -q "github-actions-deploy" "$AUTH_KEYS" 2>/dev/null; then
  echo "Key already present in authorized_keys — skipping"
else
  echo "$ENTRY" >> "$AUTH_KEYS"
  chmod 600 "$AUTH_KEYS"
  echo "Restricted deploy key added to authorized_keys"
fi

echo "---"
echo "Current authorized_keys entries:"
grep -o 'comment\|github-actions\|avyra-vps\|command=' "$AUTH_KEYS" | head -10 || tail -2 "$AUTH_KEYS" | cut -c1-80
