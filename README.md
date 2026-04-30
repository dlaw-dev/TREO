# TREO

Salesforce DX project for the TREO org metadata and custom Apex development.

## What Lives Here

This repository contains Salesforce metadata and custom code for TREO features, including:

- calendar and scheduling experiences built with Lightning Web Components
- Apex controllers that power event, attendee, task, and matter calendar data
- custom notes and time-tracking UI for matter-centric workflows

## Project Structure

- `force-app/`: default package directory for Salesforce metadata
- `scripts/`: project automation and helper scripts
- `config/`: Salesforce org and deployment configuration

## Key Areas

- `force-app/main/default/lwc/eventsCalendar/`: event calendar UI and interactions
- `force-app/main/default/lwc/eventCreateModalAction/`: event creation modal behavior and styling
- `force-app/main/default/lwc/taskCreateModalAction/`: task creation modal behavior and styling
- `force-app/main/default/lwc/neosMatterCalendar/`: matter calendar UI
- `force-app/main/default/lwc/neosCustomNotesTable/`: matter custom notes table and search/sort behavior
- `force-app/main/default/classes/`: Apex controllers and tests that back the LWC experiences
- `force-app/main/default/lwc/eventsCalendarDatatable/`: custom datatable cell types used by calendar views

## Prerequisites

- Node.js and npm
- Salesforce CLI
- Access to TREO GitHub repository and Salesforce orgs (sandbox/prod)

## Setup

```bash
npm install
sf org login web --alias <your-org-alias>
```

List authenticated orgs:

```bash
sf org list --all
```

If local auth looks stale, re-auth:

```bash
sf org login web --alias <your-org-alias> --instance-url https://login.salesforce.com
```

## Validation

Run these before committing or deploying when you have dependencies installed:

```bash
npm run prettier:verify
npm run lint
npm run test
```

## Deploying Metadata

Use Salesforce CLI commands that match your org and deployment workflow.

Deploy all source:

```bash
sf project deploy start --source-dir force-app
```

Validate against an org without immediately promoting changes:

```bash
sf project deploy start --source-dir force-app --target-org <your-org-alias> --dry-run
```

Deploy targeted metadata while iterating on a feature:

```bash
sf project deploy start --metadata LightningComponentBundle:eventsCalendar --metadata ApexClass:EventCalendarController
```

Deploy a single LWC bundle:

```bash
sf project deploy start --source-dir force-app/main/default/lwc/<bundleName> --target-org <your-org-alias>
```

Deploy selected Apex + run only specific test classes:

```bash
sf project deploy start \
  --source-dir force-app/main/default/classes/<ClassFolderName> \
  --target-org <your-org-alias> \
  --test-level RunSpecifiedTests \
  --tests <TestClassName>
```

## Release Safety Checklist

Before production deploy:

1. Validate first with `--dry-run`.
2. Deploy only targeted metadata paths.
3. If deploying Apex, use `RunSpecifiedTests` for impacted tests.
4. Keep a rollback point in git (tag or commit SHA) before deploy.

Quick rollback approach:

```bash
git checkout <rollback-tag-or-sha> -- force-app/main/default/<target-path>
sf project deploy start --source-dir force-app/main/default/<target-path> --target-org <your-org-alias>
```

## Notes For Contributors

- Keep Apex classes paired with corresponding `*Test.cls` coverage updates.
- Prefer running formatter, lint, and LWC Jest checks before pushing.
- If you add new metadata-backed features, update this README with the main component or controller entry points so the repo stays easy to navigate.
