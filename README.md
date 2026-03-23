# dropship-cli

AI-powered autonomous dropshipping operator. Like Claude Code, but instead of writing code, it runs your dropshipping business from the terminal.

Connect your Shopify store, point it at CJ Dropshipping, and let AI agents handle product sourcing, pricing, fulfillment, revenue protection, customer support, and more.

## Install

```bash
npm install -g dropship-cli
```

Or clone and link locally:

```bash
git clone https://github.com/youruser/dropship-cli.git
cd dropship-cli
npm install
npm link
```

## Quick Start

```bash
# 1. Connect your store
dropship connect

# 2. See what you're working with
dropship status

# 3. Find products to sell
dropship scout

# 4. Source a product from CJ and import to Shopify
dropship source "LED desk lamp"

# 5. Let AI run everything
dropship autopilot
```

## Commands

| Command | What it does |
|---------|-------------|
| `dropship connect` | Connect Shopify store + CJ Dropshipping |
| `dropship status` | Quick business overview |
| `dropship scout` | Find trending products to sell |
| `dropship source <query>` | Source product from CJ, import to Shopify |
| `dropship price` | Optimize all product prices |
| `dropship fulfill` | Process pending orders via CJ |
| `dropship guard` | Revenue protection scan |
| `dropship analyze` | Business analytics report |
| `dropship segment` | Customer segmentation (RFM) |
| `dropship growth` | Ad campaign management |
| `dropship support` | Handle customer tickets |
| `dropship audit` | Full business audit (A-F grading) |
| `dropship intel` | Competitive intelligence (SWOT) |
| `dropship supplier` | Supplier analysis with real CJ pricing |
| `dropship forecast` | Revenue + inventory forecasting |
| `dropship profit` | Real P&L profit analysis |
| `dropship email` | Email marketing sequences |
| `dropship doctor` | System health check |
| `dropship autopilot` | Run everything autonomously |
| `dropship config` | View/edit configuration |

## How It Works

Every command is an AI agent powered by Claude. Each agent has specialized tools that connect to your Shopify store and CJ Dropshipping. The agent sees your real data, reasons about it, and takes action.

```
You run a command
    |
    v
AI agent receives task + tools
    |
    v
Claude analyzes your store data
    |
    v
Calls tools (Shopify API, CJ API)
    |
    v
Iterates until task is complete
    |
    v
Reports results to your terminal
```

`dropship autopilot` orchestrates all agents — it checks business state, decides what needs attention, and runs the right agents in the right order. Every 15 minutes.

## Requirements

- Node.js 18+
- Shopify store with Admin API access token
- Anthropic API key (Claude)
- CJ Dropshipping account (optional, for real supplier integration)

## Configuration

Credentials are stored locally via the `conf` package (persists across restarts). You can also use environment variables:

```bash
cp .env.example .env
# Fill in your keys
```

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SHOPIFY_SHOP` | Yes | yourstore.myshopify.com |
| `SHOPIFY_ACCESS_TOKEN` | Yes | Shopify Admin API token |
| `CJ_EMAIL` | No | CJ Dropshipping email |
| `CJ_PASSWORD` | No | CJ Dropshipping password |
| `SUPABASE_URL` | No | For persistent state |
| `SUPABASE_SERVICE_KEY` | No | For persistent state |

## Testing

```bash
npm test
```

Runs 45 self-tests covering all libs, skills, CLI commands, and integration checks.

## License

MIT
