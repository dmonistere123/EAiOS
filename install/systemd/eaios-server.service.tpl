# EAiOS production server (Phase 8.2) — serves the built app + all APIs on
# 127.0.0.1:5200. Rendered from install/systemd/eaios-server.service.tpl by
# scripts/install-systemd-user.sh — do not hand-edit the rendered copy.
[Unit]
Description=EAiOS executive dashboard server (prod)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=@HOME@/.local/bin:@HOME@/.hermes/bin:/usr/local/bin:/usr/bin:/bin
Environment=EAIOS_PORT=5200
Environment=EAIOS_HOST=127.0.0.1
Environment=EAIOS_ROOT=@EAIOS_ROOT@
Environment=HERMES_HOME=@HOME@/.hermes
WorkingDirectory=@EAIOS_ROOT@/app
ExecStart=@NODE_BIN@ @EAIOS_ROOT@/app/server/prod.ts
Restart=on-failure
RestartSec=3
# Hardening (spec §15: least privilege for a loopback service)
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
