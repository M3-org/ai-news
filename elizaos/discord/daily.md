# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Bug Fixes and Version Management

**Discord Plugin Integration Crisis**: A critical bug was identified in ElizaOS version 1.7.0 affecting the Discord plugin's ability to detect server IDs, usernames, and server ownership. The issue stemmed from a transition from `serverId` to `messageServerId` in the codebase. Odilitime diagnosed the problem and created a fix branch (odi-17) with updates to bootstrap's actions/providers to work with plugin-discord 1.3.3. However, the initial fix (PR #6333) didn't work with Discord 1.3.3, necessitating testing across various Discord branches and a new Discord release. The recommended workaround was reverting to core version 1.6.5 until fixes are merged.

**Database Migration Issues**: Developers encountered destructive migration errors when running `elizaos start` a second time, with the system blocking migrations that would drop columns like "agent_id" and "room_id" from the worlds table. The solution was to set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development environments.

### Cloud Infrastructure and Architecture

**Performance Optimization**: Stan identified multiple ways to improve monorepo latency and planned to submit multiple PRs. Cloud infrastructure fixes are being implemented to handle TOCTOU (Time-of-check to time-of-use) race conditions using a "deduct-before, reconcile-after" approach combined with deslop. Runtime initialization optimizations are also in progress.

**Discord Gateway Architecture**: Discussion emerged around connector gateway implementation and scaling considerations. The team agreed that simple event pumps are the direction forward, with multiple daemon instances per service needed for scale. Voice connections will require higher priority/bandwidth event pumps compared to text, with preprocessing expected to provide significant benefits. Odilitime recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation.

### Development Contributions and New Features

**New Contributor Onboarding**: aicodeflow, a blockchain + AI engineer, introduced themselves and expressed interest in contributing to agent autonomy with constraints. They highlighted three key development areas:
- Agent-to-onchain execution layers with explicit guardrails
- Practical agent templates for prediction markets and event-driven systems
- Observability and accountability tooling for inspectable agent decisions

They also offered expertise in cleaning up embedding delegation, redesigning plugins as "skills" rather than integrations, and building market-aware agents focused on interpretation/state rather than execution.

**X402 Protocol Integration**: AlleyBoss announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), offering a simplified implementation approach.

**RSS Feed Dashboard**: jin shared RSS feed URLs for ElizaOS documentation and suggested creating a combined dashboard with multiple data sources.

### API and Model Configuration

**Model Parameter Format Issues**: Users encountered "Model not found" errors when integrating ElizaOS cloud agents into websites. The resolution required using provider prefix format for model parameters (e.g., `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash`).

**Cursor API Insights**: Odilitime shared findings from a Cursor call revealing that using your own Claude API key means you don't get Cursor's optimized version of Claude with their output improvement tricks.

### Marketing and Community Visibility

**Contract Address Accessibility**: Significant discussion about the difficulty of finding official contract addresses (CA). The team acknowledged the issue, with plans to update the Linktree to point to CoinGecko rather than pinning tweets or adding CAs to bios. The team committed to posting the ElizaOS contract address across all official X accounts.

**Token Migration Confusion**: Multiple users sought clarification on AI16Z to ElizaOS migration mechanics, particularly regarding the 120X calculation based on market cap differences and the November 11 snapshot deadline. It was clarified that buying after the November 11 snapshot means no migration eligibility.

### Project Status Updates

**DegenAI Development**: Community members inquired about DegenAI updates. The consensus was that a new version hasn't shipped yet, with the current version remaining basic. Discussion emerged about potentially consolidating DegenAI functionality into ElizaOS given DegenAI's 1M market cap.

**Content Accuracy**: The team identified an incorrect fact about Eigenlayer that appeared on their website and was subsequently picked up by LLMs, creating a propagation issue. They agreed to omit this from future content.

## Key Questions & Answers

**Q: Why does the Discord plugin fail to detect server ID, username, and server owner despite correct configuration?**
A: This is due to the transition from serverId to messageServerId in ElizaOS 1.7.0; fixes are in the odi-17 branch or use core version 1.6.5 (answered by Odilitime)

**Q: How do I run elizaos start without getting destructive migration errors?**
A: Set ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true when starting: `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true elizaos start` (answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")

**Q: How can I continuously monitor code changes on the agent?**
A: Use `elizaos dev` command instead of `elizaos start` (answered by Omid Sa)

**Q: How do I fix "Model not found" error when building ElizaOS cloud agents into a website?**
A: Use provider prefix format for model parameter like openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash (answered by cjft)

**Q: If I buy AI16Z now and migrate after 30 days, will I get 120X?**
A: If you buy after the snapshot (November 11) you can't migrate (answered by Omid Sa)

**Q: Should each problematic connector have its own gateway?**
A: Direction is simple event pumps, and we'll need more than one daemon instance per service for scale. Voice connections will need higher priority/bandwidth event pumps than text. (answered by Odilitime)

**Q: What changes have been made with DegenAI?**
A: The new version hasn't shipped yet, still pretty basic (answered by satsbased)

**Q: Do we have a team or workspace on hackmd?**
A: Yes (answered by jin, shared https://hackmd.io/@elizaos/book)

## Community Help & Collaboration

**Odilitime → DigitalDiva**: Diagnosed Discord plugin failing with server ID detection errors as serverId to messageServerId transition in 1.7.0, created fix branch odi-17, recommended using core 1.6.5 as workaround

**! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" → Andrei Mitrea**: Provided solution for destructive database migration error by setting ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true environment variable for local development

**Omid Sa → Andrei Mitrea**: Recommended using elizaos dev command instead of elizaos start for continuous monitoring of code changes

**cjft → ElizaBAO**: Explained correct model parameter format requires provider prefix (openai/, anthropic/, google/) to resolve "Model not found" error

**Odilitime → aicodeflow**: Directed to Spartan project for DeFi utilities, explained plugin-based architecture, suggested reading code and working on plugins

**Odilitime → Stan ⚡**: Recommended reviewing Jeju cloud branch with Shaw's preferred Discord bridge implementation at https://github.com/elizaOS/eliza-cloud-v2/tree/jeju/apps/discord-gateway

**shaw → DigitalDiva**: Suggested creating a simple hello world script with discord.js to test permissions and env vars, identified likely user error in Discord dev portal

**Kenk → aicodeflow**: Suggested connecting with Odilitime and mentioned upcoming open sessions for new contributors

**satsbased → aicodeflow**: Directed to contribute to open source ElizaOS in the appropriate channel

**jin → Stan ⚡**: Confirmed existence of HackMD team workspace and shared link to elizaOS book

## Action Items

### Technical

- **Fix Discord plugin server ID detection issue in ElizaOS 1.7.0** - branch odi-17 created with bootstrap actions/providers fixes (Mentioned by: Odilitime)
- **Test and merge odi-17 branch fixes for plugin-discord 1.3.3 compatibility** (Mentioned by: Odilitime)
- **Rush out release with version 1.7.0 fix (PR #6333)** (Mentioned by: Odilitime)
- **Test Discord fix with various Discord branches and cut new Discord release** (Mentioned by: Odilitime)
- **Submit multiple PRs for monorepo latency improvements** (Mentioned by: Stan ⚡)
- **Implement cloud fixes for TOCTOU race conditions using deduct-before, reconcile-after approach** (Mentioned by: Stan ⚡)
- **Complete runtime initialization optimizations** (Mentioned by: Stan ⚡)
- **Plan scaling architecture for event pumps with multiple daemon instances per service** (Mentioned by: Odilitime)
- **Develop agent-to-onchain execution layers with explicit guardrails** (Mentioned by: aicodeflow)
- **Build practical agent templates for prediction markets and event-driven systems** (Mentioned by: aicodeflow)
- **Create observability and accountability tooling for inspectable agent decisions** (Mentioned by: aicodeflow)
- **Clean up embedding delegation on agent side to avoid hidden dependencies** (Mentioned by: aicodeflow)
- **Redesign plugins as "skills" rather than just integrations for better composability** (Mentioned by: aicodeflow)
- **Build market-aware agents focused on interpretation/state instead of execution** (Mentioned by: aicodeflow)
- **Implement application building functionality for agents to use custom-built apps** (Mentioned by: Connor On-Chain)
- **Investigate Discord bot server ID detection issue causing "No server ID found 10" error** (Mentioned by: DigitalDiva)

### Documentation

- **Update Linktree to point to CoinGecko for easier contract address discovery** (Mentioned by: Kenk)
- **Post ElizaOS contract address across official X accounts** (Mentioned by: shaw)
- **Document proper model parameter format with provider prefixes for API endpoints** (Mentioned by: cjft)
- **Review and provide feedback on Stan's HackMD documentation** (Mentioned by: Stan ⚡)
- **Avoid repeating incorrect Eigenlayer fact in future content** (Mentioned by: Borko)

### Feature

- **Refine RSS pipeline and combine feeds into dashboard with additional data sources** (Mentioned by: jin)
- **Experiment with x402 protocol integration using @alleyboss/micropay-solana-x402-paywall library** (Mentioned by: AlleyBoss)
- **Consider consolidating DegenAI utility into ElizaOS** (Mentioned by: Error P015-A)
- **Explore Polymarket-based agent plugins following Predict post mention** (Mentioned by: meltingsnow)
- **Host open sessions for new contributors in the near future** (Mentioned by: Kenk)