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

## Setup

```bash
npm install
sf org login web --alias <your-org-alias>
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
sf project deploy validate --source-dir force-app --target-org <your-org-alias>
```

Deploy targeted metadata while iterating on a feature:

```bash
sf project deploy start --metadata LightningComponentBundle:eventsCalendar --metadata ApexClass:EventCalendarController
```

## Notes For Contributors

- Keep Apex classes paired with corresponding `*Test.cls` coverage updates.
- Prefer running formatter, lint, and LWC Jest checks before pushing.
- If you add new metadata-backed features, update this README with the main component or controller entry points so the repo stays easy to navigate.
