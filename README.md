# TREO

Salesforce DX project for the TREO org metadata and custom Apex development.

## Project Structure

- `force-app/`: default package directory for Salesforce metadata
- `scripts/`: project automation and helper scripts
- `config/`: Salesforce org and deployment configuration

## Prerequisites

- Node.js and npm
- Salesforce CLI

## Useful Commands

```bash
npm install
npm run prettier:verify
npm run test
```

## Deploying Metadata

Use Salesforce CLI commands that match your org and deployment workflow. Example:

```bash
sf project deploy start --source-dir force-app
```
