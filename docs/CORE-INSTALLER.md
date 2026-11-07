# EAiOS core installer

For a new box, use the separate entry point from a v0.1.13 checkout:

```bash
bash install/install-core.sh
```

For a remote installation:

```bash
curl -fsSL https://raw.githubusercontent.com/dmonistere123/EAiOS/v0.1.13/install/install-core.sh | bash
```

The existing `install/install.sh` remains the full installer. The updater is shared by both editions and reads the machine's persistent module selection from `EAIOS_DATA_ROOT/modules.local.json`. Missing configuration means full edition, preserving existing boxes. Invalid configuration fails closed rather than silently enabling optional modules.

A new core configuration is:

```json
{"edition":"core","addons":[]}
```

Supported optional additions are `social` and `podcasts`. An engineer can add those identifiers to `addons` when commissioned. The core installer preserves an existing configuration, and an existing legacy installation with no configuration retains the full edition. Custom agents, skills, instructions and credentials are not bundled into module configuration.

Both editions share source and sidecar dependencies. Optional-module UI routes and application API paths are disabled in core; this is product configuration, not a security sandbox around Hermes tools or direct sidecar access. There is no automatic “three custom modules” builder or licensing enforcement in this release.

Acceptance on a new customer box: verify core navigation, connect the customer's providers, run a harmless assistant request, verify communication approval, check a scheduled internal task, verify voice availability if configured, and run an upgrade while confirming module choices and customer state remain intact. Automated tests use temporary homes; no clean OS installation has been performed on this production machine.
