# Dropship CLI — Build Order

## What This Is
AI-powered autonomous dropshipping operator. Like Claude Code, but instead of writing code, it runs a dropshipping business from your terminal. Connects to Shopify, finds products from CJ Dropshipping, sets prices, fulfills orders, protects revenue — all autonomous, all AI.

## Build Order (follow exactly)

### Phase 1: Core Infrastructure
1. `bin/dropship.js` — CLI entry point with Commander (20 commands)
2. `lib/config.js` — Store credentials, API keys, persistent config via `conf`
3. `lib/ai.js` — Claude AI client with tool use, rate limiting, retry (the brain)
4. `lib/shopify.js` — Shopify API client with retry logic
5. `lib/db.js` — Supabase client for state persistence (optional, graceful without)
6. `lib/logger.js` — Styled terminal output with chalk + ora
7. `lib/cj.js` — CJ Dropshipping API client (token management, product search, order placement, tracking)
8. `lib/suppliers.js` — Multi-supplier router with scoring (cost/speed/reliability)

### Phase 2: Skills (17 AI Agent Commands)
9. `skills/scout.js` — Find trending products (market analysis + CJ catalog search)
10. `skills/source.js` — Source product from CJ and import to Shopify
11. `skills/price.js` — Optimize prices (psychological pricing, velocity-aware)
12. `skills/fulfill.js` — Process orders (CJ order placement, tracking, fraud detection)
13. `skills/guard.js` — Revenue protection scan (stockouts, margins, threats)
14. `skills/analyze.js` — Analytics + KPI report (revenue, products, customers)
15. `skills/segment.js` — Customer segmentation (RFM analysis, 7 segments)
16. `skills/growth.js` — Ad campaign management (ROAS-driven, kill/scale rules)
17. `skills/support.js` — Customer ticket handling (draft responses, refund logic)
18. `skills/audit.js` — Full business audit (A-F grading, 6 areas)
19. `skills/intel.js` — Competitive intelligence (SWOT analysis, strategic actions)
20. `skills/supplier.js` — Supplier management (real CJ pricing, margin analysis)
21. `skills/forecast.js` — Revenue + inventory forecasting (stockout prediction)
22. `skills/profit.js` — Real P&L analysis (true profit after ALL costs)
23. `skills/email.js` — Email marketing (post-purchase, winback, abandoned cart)
24. `skills/doctor.js` — System health check and error diagnosis
25. `skills/autopilot.js` — Autonomous mode (orchestrates all skills)

### Phase 3: Self-Test + Polish
26. `skills/self-test.js` — Validates all skills load and run (45 tests)
27. Wire everything into Commander CLI
28. Test all commands end-to-end

## Architecture
- Every skill is an AI agent with Claude tool use (tool_use API)
- AI agent loop: system prompt → task → tool calls → iterate → final response
- Rate-limited API calls with exponential backoff retry
- Graceful degradation: works without Supabase or CJ (loses persistence/supplier features)
- Error boundaries: skill failures don't crash autopilot
- CJ tools use dynamic imports for graceful degradation

## Critical Rules
- Every skill is an AI agent with Claude tool use
- Never hardcode store URLs — always from config
- All Shopify calls go through lib/shopify.js with retry
- All CJ calls go through lib/cj.js with retry + token management
- All AI calls go through lib/ai.js (rate-limited, retried)
- All output goes through lib/logger.js (styled, consistent)
- Config persisted via `conf` package (survives restarts)
- CJ tokens cached in conf, auto-refresh at <24h remaining

## CLI Commands
```
dropship connect           — Connect Shopify store + CJ Dropshipping
dropship scout             — Find trending products to sell
dropship source <query>    — Source product from CJ and import to Shopify
dropship price             — Optimize all product prices
dropship fulfill           — Process pending orders via CJ
dropship guard             — Revenue protection scan
dropship analyze           — Business analytics report
dropship segment           — Customer segmentation
dropship growth            — Ad campaign management
dropship support           — Handle customer tickets
dropship audit             — Full business audit
dropship intel             — Competitive intelligence
dropship supplier          — Supplier analysis with real CJ pricing
dropship forecast          — Revenue + inventory forecasting
dropship profit            — Real P&L profit analysis
dropship email             — Email marketing sequences
dropship doctor            — System health check + error diagnosis
dropship autopilot         — Run everything autonomously
dropship status            — Quick business overview
dropship config            — View/edit configuration
```
