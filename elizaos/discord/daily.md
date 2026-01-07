# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Discord Plugin Integration Issues

A major technical crisis emerged with the Discord plugin in ElizaOS version 1.7.0. Users experienced critical errors where bots couldn't detect server IDs, usernames, or server owners despite proper intent configuration and admin permissions. The root cause was identified as a transition from `serverId` to `messageServerId` in the codebase.

**Resolution Path**: Odilitime (lead dev on Spartan project) diagnosed the issue and created a fix branch (odi-17) with updates to bootstrap's actions/providers to work with plugin-discord 1.3.3. However, the fix didn't work with Discord 1.3.3, necessitating testing across various Discord branches and a new Discord release. The recommended temporary workaround was reverting to core version 1.6.5 until fixes were merged. A critical PR #6333 was identified for version 1.7.0 fix, with plans to rush out a release.

### Cloud Infrastructure and Architecture Improvements

**Performance Optimization**: Stan identified multiple ways to improve monorepo latency and planned to submit multiple PRs. He's working on cloud fixes to handle TOCTOU (Time-of-check to time-of-use) race conditions using a "deduct-before, reconcile-after" approach combined with deslop. Runtime initialization optimizations are also in progress.

**Discord Gateway Architecture**: Discussion emerged around connector gateway implementation. The team discussed scaling considerations, noting that simple event pumps are the direction forward, with multiple daemon instances per service needed for scale. Voice connections will require higher priority/bandwidth event pumps compared to text, with preprocessing expected to provide significant benefits. Odilitime recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation.

### Database Migration and Development Workflow

Andrei Mitrea encountered a database migration error when running `elizaos start` a second time. The system blocked destructive migrations that would drop columns like "agent_id" and "room_id" from the worlds table. The solution was to set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development. Additionally, the team recommended using `elizaos dev` instead of `elizaos start` for continuous monitoring during development.

### New Contributor Onboarding

**aicodeflow**, a blockchain + AI engineer, introduced themselves with expertise in agent autonomy systems with guardrails, particularly around DeFi interactions and policy-gated execution. They expressed interest in contributing to:
- Agent-onchain execution layers with explicit guardrails
- Prediction market templates and event-driven systems
- Observability and accountability tooling for inspectable agent decisions
- Embedding delegation for model-agnostic setups
- Refactoring plugins as "skills" rather than just integrations
- Building market-aware agents focusing on interpretation/state instead of execution

Odilitime directed them to the Spartan project and suggested starting with plugin-based development from github.com/elizaos-plugins/.

### API Integration and Model Configuration

**ElizaOS Cloud Agent Integration**: ElizaBAO encountered a "Model not found" error when integrating ElizaOS cloud agents into their website. The issue was resolved by explaining the correct model parameter format requires provider prefixes (e.g., `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash`).

**x402 Protocol Integration**: AlleyBoss announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), providing an easier implementation path.

**Cursor API Insights**: Odilitime shared findings from a Cursor call revealing that using your own Claude API key means you don't get Cursor's optimized version of Claude with their output improvement tricks.

### Token and Marketing Concerns

Multiple users raised concerns about difficulty finding official contract addresses (CA). The team acknowledged this issue, with plans to update linktree to point to CoinGecko. Discussion about pinned tweets versus bio placement for CA visibility occurred, with consensus that current discoverability is inadequate. The team committed to posting the ElizaOS contract address across all official X accounts.

**Migration Questions**: Confusion around AI16Z to ElizaOS migration mechanics emerged, particularly regarding snapshot dates (November 11) and token ratios. Users who purchased after the snapshot date cannot migrate.

### DegenAI Development Status

Discussion about DegenAI's current state revealed it remains basic with a new version pending release. At 1M market cap, there was debate about its future utility versus consolidating features into ElizaOS core.

### Documentation and Content

**Documentation Resources**: Jin shared RSS feed URLs for ElizaOS documentation and suggested creating a combined dashboard with multiple data sources. Stan created documentation on HackMD and requested team review. The team confirmed a HackMD workspace exists at https://hackmd.io/@elizaos/book.

**Content Correction**: The team identified an incorrect fact about Eigenlayer that appeared on their website and was subsequently picked up by LLMs, creating a propagation issue. They agreed to omit this from future content.

## Key Questions & Answers

**Q: Why does the Discord plugin show "No server ID found" errors?**  
A: This is because we're moving from serverId to messageServerId, related to using develop branch of elizaos. (answered by Odilitime)

**Q: What version of ElizaOS should I use to avoid Discord issues?**  
A: Might be easier to use an older core like 1.6.5 until fixes are merged. (answered by Odilitime)

**Q: How do I run elizaos start without getting destructive migration errors?**  
A: Set ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true when starting: `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true elizaos start` (answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")

**Q: What command should I use for continuous monitoring during development?**  
A: Use `elizaos dev` instead of `elizaos start` for continuous monitoring. (answered by Omid Sa)

**Q: How do I fix "Model not found" error when building ElizaOS cloud agents into a website?**  
A: Use provider prefix format for model parameter like openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash. (answered by cjft)

**Q: If I buy ai16z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (11 November) you can't migrate. (answered by Omid Sa)

**Q: Should each problematic connector have its own gateway?**  
A: Direction is simple event pumps, and we'll need more than one daemon instance per service for scale. Voice connections will need higher priority/bandwidth event pumps than text. (answered by Odilitime)

**Q: Do we have a team or workspace on hackmd?**  
A: Yes, at https://hackmd.io/@elizaos/book (answered by jin)

**Q: What are earning agents?**  
A: Agents that make you money. (answered by satsbased)

**Q: Is the Babylon that a16z invested in related to elizaos?**  
A: Nope. (answered by degenwtf)

## Community Help & Collaboration

**Discord Integration Debugging** (Helpers: Odilitime, shaw, Casino | Helpee: DigitalDiva)  
DigitalDiva struggled with Discord bot not detecting server ID, username, or server owner despite proper configuration. The team diagnosed it as a serverId to messageServerId transition issue, created fix branch (odi-17), and suggested reverting to 1.6.5 or using test branch. Shaw also suggested creating a simple hello world script with discord.js to isolate permission issues in discord dev portal.

**Database Migration Support** (Helper: ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" | Helpee: Andrei Mitrea)  
When Andrei encountered destructive migration errors blocking column drops in database, the helper provided the solution to set ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true environment variable for local development.

**API Model Configuration** (Helper: cjft | Helpee: ElizaBAO)  
When ElizaBAO faced "Model not found" errors calling agent API endpoints from their website, cjft explained the correct model parameter format with provider prefixes.

**New Contributor Guidance** (Helpers: satsbased, Kenk, Odilitime | Helpee: aicodeflow)  
Multiple team members helped onboard a new blockchain/AI engineer by directing them to contribute to open source ElizaOS in dev-chat channel, connecting them with Odilitime, mentioning upcoming open sessions, and directing them to the Spartan project with suggestions to work on plugins from github.com/elizaos-plugins/.

**Discord Gateway Architecture** (Helper: Odilitime | Helpee: Stan ⚡)  
When Stan was working on Discord connector implementation, Odilitime recommended reviewing the Jeju cloud branch with Shaw's preferred Discord bridge implementation at https://github.com/elizaOS/eliza-cloud-v2/tree/jeju/apps/discord-gateway.

**Development Workflow Optimization** (Helper: Omid Sa | Helpee: DigitalDiva)  
Omid recommended using `elizaos dev` command instead of `elizaos start` for continuous monitoring during development.

**Token Migration Support** (Helper: The Light | Helpee: henry)  
Directed user needing help migrating tokens held in Tangem at time of snapshot to the migration-support channel.

**Partnership Connection** (Helper: Kenk | Helpee: S_ling Clement)  
Suggested connecting with specific user for Voidix collaboration regarding liquidity management and market making partnerships.

**Documentation Access** (Helper: jin | Helpee: Stan ⚡)  
Confirmed existence of HackMD team workspace and shared link when Stan asked about documentation resources.

## Action Items

### Technical

- **Fix Discord plugin server ID detection issue in ElizaOS 1.7.0** - branch odi-17 created with bootstrap fixes (Mentioned by: Odilitime)
- **Test and merge Discord plugin fixes** for compatibility with plugin-discord 1.3.3 (Mentioned by: Odilitime)
- **Rush out release with version 1.7.0 fix** (PR #6333) (Mentioned by: Odilitime)
- **Test Discord fix with various Discord branches** and cut new Discord release (Mentioned by: Odilitime)
- **Submit multiple PRs for monorepo latency improvements** (Mentioned by: Stan ⚡)
- **Implement cloud fixes for TOCTOU race conditions** using deduct-before, reconcile-after approach (Mentioned by: Stan ⚡)
- **Complete runtime initialization optimizations** with deeper testing and validation (Mentioned by: Stan ⚡)
- **Investigate and fix Discord bot server ID detection issue** causing "No server ID found 10" error (Mentioned by: DigitalDiva)
- **Clean up embedding delegation on agent side** for model-agnostic setups (Mentioned by: aicodeflow)
- **Refactor plugins as "skills"** rather than just integrations for better composability (Mentioned by: aicodeflow)
- **Build market-aware agents** focusing on interpretation/state instead of execution (Mentioned by: aicodeflow)
- **Ship new version of DegenAI** with improvements (Mentioned by: satsbased)

### Feature

- **Post ElizaOS contract address** across all official X accounts managed by team (Mentioned by: shaw)
- **Improve contract address discoverability** - current flow doesn't work for most users (Mentioned by: Broccolex)
- **Update linktree to point to CoinGecko** for easier contract address discovery (Mentioned by: Kenk)
- **Implement application building functionality** for agents (Mentioned by: Connor On-Chain)
- **Develop agent-onchain execution layers** with explicit guardrails (Mentioned by: aicodeflow)
- **Create practical agent templates** for prediction markets and event-driven systems (Mentioned by: aicodeflow)
- **Build observability and accountability tooling** for inspectable agent decisions (Mentioned by: aicodeflow)
- **Explore Polymarket-based agent plugins integration** (Mentioned by: meltingsnow)
- **Create combined RSS dashboard** integrating multiple ElizaOS data sources (Mentioned by: jin)

### Documentation

- **Document ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS environment variable usage** for development vs production (Mentioned by: ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")
- **Document correct model parameter format** with provider prefixes for API endpoints (Mentioned by: cjft)
- **Document difference between elizaos start and elizaos dev commands** (Mentioned by: Omid Sa)
- **Schedule open sessions for new contributors** in near future (Mentioned by: Kenk)
- **Review and provide feedback on Stan's documentation** at https://hackmd.io/@0PzDTGXqRg6nOCDoEwaN-A/SyDNAAiVWe (Mentioned by: Stan ⚡)
- **Avoid repeating incorrect Eigenlayer fact** in future content (Mentioned by: Borko)