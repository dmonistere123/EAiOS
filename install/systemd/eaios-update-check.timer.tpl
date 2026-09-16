[Unit]
Description=Weekly EAiOS release check

[Timer]
OnCalendar=weekly
RandomizedDelaySec=12h
FixedRandomDelay=true
Persistent=true
Unit=eaios-update-check.service

[Install]
WantedBy=timers.target
