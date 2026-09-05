# EAiOS production server — Tailscale/front-door instance on 127.0.0.1:5173.
# Same prod.ts as eaios-server.service (:5200), second port so an external
# reverse proxy can front PROD. Rendered from
# install/systemd/eaios-server-5173.service.tpl — do not hand-edit.
[Unit]
Description=EAiOS executive dashboard server (prod, front door :5173)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=@HOME@/.local/bin:@HOME@/.hermes/bin:/usr/local/bin:/usr/bin:/bin
Environment=EAIOS_PORT=5173
Environment=EAIOS_HOST=127.0.0.1
Environment=EAIOS_ROOT=@EAIOS_ROOT@
Environment=HERMES_HOME=@HOME@/.hermes
WorkingDirectory=@EAIOS_ROOT@/app
ExecStart=@NODE_BIN@ @EAIOS_ROOT@/app/server/prod.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
