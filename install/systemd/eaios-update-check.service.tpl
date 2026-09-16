[Unit]
Description=Check published EAiOS releases (never installs)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=EAIOS_ROOT=@EAIOS_ROOT@
Environment=EAIOS_DATA_ROOT=@EAIOS_DATA_ROOT@
Environment=EAIOS_REPO_ROOT=@EAIOS_REPO_ROOT@
Environment=HERMES_HOME=@HERMES_HOME@
ExecStart=@NODE_BIN@ @EAIOS_ROOT@/scripts/check-updates.mjs
TimeoutStartSec=45
NoNewPrivileges=true
PrivateTmp=true
