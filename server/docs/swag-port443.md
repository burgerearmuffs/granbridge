# Running the 443-only broker behind an existing SWAG / nginx reverse proxy

The bundled stack (Caddy + caddy-l4) is the tested reference. If TOWER already runs **SWAG**
(linuxserver nginx) owning 80/443 for other services, SWAG itself must ALPN-demux 443 between its
normal HTTPS vhosts and coturn, because everything shares one hostname.

## How it works

nginx's `stream {}` module with `ssl_preread` inspects the TLS ClientHello **without terminating
TLS** and routes by negotiated ALPN: web ALPN (`h2`/`http/1.1`) → SWAG's internal HTTPS listener;
anything else → the coturn container's TLS port.

## 1. Move SWAG's HTTPS listener to an internal port

In SWAG, change the `server { listen 443 ssl; ... }` block to listen on an internal port (e.g. `4443`)
on `127.0.0.1`, so the `stream` block can own the public `443`.

## 2. Add a stream demuxer (nginx `stream {}`)

```nginx
stream {
    map $ssl_preread_alpn_protocols $upstream_443 {
        ~\bh2\b            web_https;
        ~\bhttp/1\.1\b     web_https;
        default            coturn_tls;
    }

    upstream web_https  { server 127.0.0.1:4443; }
    upstream coturn_tls { server 127.0.0.1:5349; }   # coturn container's published-to-localhost TLS port

    server {
        listen 443;
        listen [::]:443;
        proxy_pass        $upstream_443;
        ssl_preread       on;
        proxy_protocol    on;     # so the web backend can recover the real client IP
    }
}
```

Requires nginx built with `--with-stream` and `--with-stream_ssl_preread_module` (SWAG includes both).
Add the matching `proxy_protocol` / `set_real_ip_from` config on SWAG's `4443` server block, and
`acme-tls/1` to the `web_https` match if SWAG renews via TLS-ALPN-01 (use HTTP-01 on :80 otherwise).

## 3. coturn

Run only the `coturn` service from `docker-compose.yml` (plus `init`), publishing its TLS port to
`127.0.0.1:5349` so the `stream` upstream can reach it. The shipped compose publishes **no** coturn host
ports (bridge-net only), so add a small override file to expose it to localhost:

```yaml
# docker-compose.swag.yml  — docker compose -f docker-compose.yml -f docker-compose.swag.yml up -d init coturn
services:
  coturn:
    ports:
      - "127.0.0.1:5349:5349"
```

coturn still reuses the cert SWAG manages (point its cert volume/path at SWAG's cert for `$DOMAIN`).

> This variant is provided for your environment and is **validated by you on TOWER** — it is not
> exercised by the repo's automated tests.
