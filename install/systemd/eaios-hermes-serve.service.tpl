# hermes serve for EAiOS live mode (Phase 8.2) — the dashboard WS/JSON-RPC
# surface on 127.0.0.1:9119. The wrapper script owns token loading (reads
# ~/.hermes/.eaios-dev-token, never inlines it). Rendered from
# install/systemd/eaios-hermes-serve.service.tpl — do not hand-edit.
[Unit]
Description=Hermes serve (EAiOS live-mode gateway)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=@HOME@/.local/bin:@HOME@/.hermes/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=@EAIOS_ROOT@/scripts/start-hermes-serve.sh
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
