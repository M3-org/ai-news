# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Bug Fixes and Version Management

The development team addressed critical issues in ElizaOS v1.7.0, particularly around Discord integration. A major bug fix (PR #6333) was merged, though concerns were raised about rushing the release. The core issue involved a transition from `serverId` to `messageServerId` in the codebase, causing Discord bots to fail with "No server ID found" errors. Odilitime created a custom branch (odi-17) with fixes for bootstrap's actions/providers and recommended either downgrading to v1.6.5 or using the development branch. Compatibility testing across multiple Discord branches was identified as necessary before cutting a new Discord release.

### Performance Optimization Initiatives

Stan identified multiple latency improvements for the monorepo and planned to submit several PRs with accompanying documentation. Key optimization areas include:
- Cloud fixes to handle TOCTOU (Time-of-check to time-of-use) race conditions using a "deduct-before, reconcile-after" approach
- Runtime initialization optimizations
- Connector gateway improvements for problematic integrations

### Architecture and Scaling Strategy

The team discussed moving toward simple event pumps with multiple daemon instances per service for better scalability. Voice connections were identified as requiring higher priority/bandwidth event pumps compared to text channels, with preprocessing expected to provide significant benefits. Odilitime recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation as a reference for connector architecture.

### New Contributor Onboarding

aicodeflow, a blockchain and AI engineer, expressed interest in contributing to ElizaOS with focus on:
- Agent autonomy with constraints
- Onchain execution layers with explicit guardrails
- Prediction market templates
- Observability and accountability tooling
- Redesigning plugins as "skills" rather than just integrations
- Building market-aware agents focused on interpretation/state rather than execution

The team directed them to the Spartan project (github.com/elizaos/spartan) for DeFi utilities and the plugin-based architecture at github.com/elizaos-plugins/.

### Integration and Protocol Updates

AlleyBoss announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), offering a simplified implementation approach. Plugin PRs were submitted for Telegram (#22) and Discord (#41).

### Database Migration Issues

Developers encountered destructive migration errors when running `elizaos start` multiple times. The system blocked migrations that would drop columns like "agent_id" and "room_id" from the worlds table. The solution involved setting `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development, with warnings about careful review for production environments.

### Model Configuration and API Integration

Users integrating ElizaOS cloud agents into websites encountered "Model not found" errors. The resolution required using provider prefix formats for model parameters (e.g., `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash`).

### Community Resources and Documentation

jin shared RSS feed URLs for ElizaOS documentation and suggested creating a combined dashboard with multiple data sources. A GitHub workflow reference was shared from GitHub Next's agentics repository for documentation updates. Technical documentation was consolidated on HackMD, including Stan's optimization documentation and a general elizaOS book.

### Token Migration and Contract Visibility

Multiple users sought clarification on AI16Z to ElizaOS migration mechanics and contract address visibility. The team acknowledged difficulty finding official contract addresses and planned to improve discoverability through linktree updates pointing to CoinGecko. Users were reminded that only tokens held at the November 11 snapshot are eligible for migration.

### DegenAI Development Status

Community members inquired about DegenAI updates. The new version hasn't shipped yet, though significant GitHub activity on ElizaOS was noted with upcoming DegenAI developments expected at a 1M market cap milestone.

## Key Questions & Answers

**Q: Why won't the Discord plugin see the server ID and username?**  
A: This is due to the transition from serverId to messageServerId in v1.7.0; use v1.6.5 or the odi-17 branch (answered by Odilitime)

**Q: How do I run elizaos start without getting destructive migration errors?**  
A: Set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` when starting: `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true elizaos start`. Safe for local dev but review carefully for production. (answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")

**Q: How do I fix "Model not found" error when building ElizaOS cloud agents into a website?**  
A: Use provider prefix format for model parameter: openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash (answered by cjft)

**Q: How can I continuously monitor code changes on the agent?**  
A: Use `elizaos dev` command instead of `elizaos start` (answered by Omid Sa)

**Q: How can I help with ElizaOS development?**  
A: Start by reading the code and asking questions; work on plugins from github.com/elizaos-plugins/ (answered by Odilitime)

**Q: What changes have been made with degenai?**  
A: The new version hasn't shipped yet (answered by satsbased)

**Q: If I buy AI16Z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (November 11), you can't migrate (answered by Omid Sa)

**Q: Should each problematic connector have its own gateway?**  
A: Direction is simple event pumps, likely need more than one daemon instance per service for scale (answered by Odilitime)

**Q: Is the Babylon that a16z invested in related to ElizaOS?**  
A: Nope (answered by degenwtf)

## Community Help & Collaboration

**Discord Integration Debugging**
- Odilitime helped DigitalDiva resolve Discord plugin issues by identifying the serverId to messageServerId transition problem and creating the odi-17 branch with bootstrap fixes
- shaw suggested creating a minimal Discord.js hello world script to isolate permission issues from the Discord developer portal
- Casino recommended limiting scope/permissions and working back to desired features

**Database Migration Support**
- ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" helped Andrei Mitrea resolve database migration errors by explaining the ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS flag usage

**Development Workflow Guidance**
- Omid Sa recommended using `elizaos dev` instead of `elizaos start` for continuous monitoring during development

**API Integration Assistance**
- cjft resolved ElizaBAO's "Model not found" error by explaining the correct model parameter format with provider prefixes

**New Contributor Onboarding**
- satsbased directed aicodeflow to contribute to open source ElizaOS in the dev channel
- Kenk connected aicodeflow with Odilitime and mentioned upcoming open sessions
- Odilitime directed aicodeflow to the Spartan project and plugin-based architecture

**Architecture Guidance**
- Odilitime recommended Stan review the Jeju cloud branch for Discord bridge implementation reference
- cjft thanked Stan for upcoming PRs on monorepo latency improvements

**Contract Address Visibility**
- Broccolex flagged difficulty finding official contract addresses to the team and discussed pinned tweet solutions
- shaw committed to posting ElizaOS contract address across all official X accounts

**Community Connections**
- Kenk helped S_ling Clement connect with specific team members about liquidity management partnerships
- The Light directed henry to the migration support channel for help with tokens held in Tangem at snapshot

## Action Items

### Technical

- Fix Discord plugin serverId to messageServerId transition issues in ElizaOS v1.7.0 (Odilitime)
- Test and merge odi-17 branch with bootstrap action/provider fixes for Discord plugin compatibility (Odilitime)
- Create minimal Discord.js hello world script to debug permission issues independently of ElizaOS (shaw)
- Push multiple PRs for monorepo latency improvements (Stan ⚡)
- Rush out release with 1.7.0 fix from PR #6333 (Odilitime)
- Test Discord fix with various Discord branches and cut new Discord release (Odilitime)
- Handle TOCTOU race conditions using deduct-before, reconcile-after approach plus deslop (Stan ⚡)
- Runtime initialization optimizations (Stan ⚡)
- Review Jeju cloud branch for Discord bridge implementation (Odilitime)
- Plan scaling strategy for event pumps with multiple daemon instances per service (Odilitime)
- Implement higher priority event pumps for voice connections vs text (Odilitime)
- Investigate and fix Discord "No server ID found 10" error where room.serverId is undefined (DigitalDiva)
- Clean up embedding delegation on agent side to avoid hidden dependencies (aicodeflow)
- Redesign plugins as "skills" rather than just integrations for better composability (aicodeflow)
- Build market-aware agents focused on interpretation/state instead of execution (aicodeflow)

### Feature

- Implement agent onchain execution layers with explicit guardrails (aicodeflow)
- Build practical agent templates for prediction markets and event-driven systems (aicodeflow)
- Develop observability and accountability tooling for inspectable agent decisions (aicodeflow)
- Implement application building capabilities for agents to use custom-built apps (Connor On-Chain)
- Explore Polymarket-based agent plugins for prediction markets (meltingsnow)
- Refine RSS pipeline and combine feeds into dashboard with additional data sources (jin)

### Documentation

- Update linktree to point to CoinGecko for easier contract address discovery (Kenk)
- Post ElizaOS contract address across all official X accounts (shaw)
- Improve contract address discoverability on website and social media within 10 seconds (Broccolex)
- Document ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS flag usage for development vs production (! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")
- Document correct model parameter format with provider prefixes for API endpoints (cjft)
- Share optimization documentation on HackMD (Stan ⚡)
- Avoid repeating incorrect Eigenlayer information in future content (Borko)