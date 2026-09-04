# EAiOS knowledge sidecar (Phase 8.2) — FTS5 knowledge/RAG on 127.0.0.1:9121.
# Deps live in sidecar/.venv (see scripts/start-knowledge-sidecar.sh header).
# Rendered from install/systemd/eaios-knowledge-sidecar.service.tpl.
[Unit]
Description=EAiOS knowledge sidecar (FTS5 RAG)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=@HOME@/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=@EAIOS_ROOT@/scripts/start-knowledge-sidecar.sh
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
