#!/bin/sh
# coturn entrypoint: reuse Caddy's Let's Encrypt cert for turns://, fall back to
# turn://-only until the cert exists, and reload automatically on renewal.
set -eu

SECRET_FILE=/secrets/turn_secret
CERT_DIR=/etc/coturn/certs
CADDY_CERTS=/caddy-data/caddy/certificates

# Resolve the shared TURN secret (env override wins; else the init-generated file).
SECRET="${TURN_SECRET:-}"
if [ -z "$SECRET" ]; then
  i=0; while [ ! -s "$SECRET_FILE" ] && [ "$i" -lt 30 ]; do sleep 1; i=$((i+1)); done
  SECRET="$(cat "$SECRET_FILE" 2>/dev/null || echo '')"
fi
if [ -z "$SECRET" ]; then echo "FATAL: no TURN secret available" >&2; exit 1; fi

REALM="${TURN_REALM:-$DOMAIN}"
mkdir -p "$CERT_DIR"

# Locate Caddy's cert (the ACME-CA subdir name varies); copy to a stable path.
copy_cert() {
  src_crt="$(find "$CADDY_CERTS" -name "${DOMAIN}.crt" 2>/dev/null | head -n1 || true)"
  src_key="$(find "$CADDY_CERTS" -name "${DOMAIN}.key" 2>/dev/null | head -n1 || true)"
  if [ -n "$src_crt" ] && [ -n "$src_key" ]; then
    cp "$src_crt" "$CERT_DIR/turn.crt"; cp "$src_key" "$CERT_DIR/turn.key"
    return 0
  fi
  return 1
}

# Wait up to ~60s for Caddy to issue the cert on first boot.
i=0; while [ "$i" -lt 60 ] && ! copy_cert; do sleep 1; i=$((i+1)); done

COMMON="-n --log-file=stdout --no-cli --fingerprint \
  --lt-cred-mech --use-auth-secret --static-auth-secret=$SECRET --realm=$REALM \
  --listening-port=3478 --min-port=49152 --max-port=65535 \
  --no-loopback-peers --no-multicast-peers \
  --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 \
  --denied-peer-ip=127.0.0.0-127.255.255.255"

[ -n "${TURN_EXTERNAL_IP:-}" ] && COMMON="$COMMON --external-ip=$TURN_EXTERNAL_IP"

if [ -f "$CERT_DIR/turn.crt" ]; then
  TLS="--tls-listening-port=5349 --cert=$CERT_DIR/turn.crt --pkey=$CERT_DIR/turn.key"
  echo "coturn: turns:// enabled (cert found)"
else
  TLS=""
  echo "WARNING: cert not found; starting turn://-only (will restart when it appears)"
fi

# Background watcher: on renewal reload in place (SIGHUP); if TLS was off and the
# cert later appears, exit so Docker restarts us with turns:// enabled.
HAD_TLS=$([ -n "$TLS" ] && echo 1 || echo 0)
( while true; do
    sleep 3600
    before="$( [ -f "$CERT_DIR/turn.crt" ] && md5sum "$CERT_DIR/turn.crt" | cut -d' ' -f1 || echo none )"
    if copy_cert; then
      after="$(md5sum "$CERT_DIR/turn.crt" | cut -d' ' -f1)"
      if [ "$HAD_TLS" = "1" ] && [ "$before" != "$after" ]; then
        echo "coturn: cert changed — reloading (SIGHUP)"; pkill -HUP turnserver || true
      elif [ "$HAD_TLS" = "0" ]; then
        echo "coturn: cert now present — restarting to enable turns://"; pkill turnserver || true
      fi
    fi
  done ) &

# shellcheck disable=SC2086
exec turnserver $COMMON $TLS
