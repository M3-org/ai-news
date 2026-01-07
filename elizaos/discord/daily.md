# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Bug Fixes and Version Management

**Discord Plugin Integration Issues**: A critical bug was identified in ElizaOS v1.7.0 affecting Discord plugin functionality. The bot couldn't detect server IDs, usernames, or server owners despite correct intent configurations and admin permissions. Odilitime traced the root cause to a transition from `serverId` to `messageServerId` in the codebase. While PR #6333 provided a fix, it proved incompatible with Discord plugin version 1.3.3, requiring additional testing across Discord branches and a new Discord release. The recommended workaround was either downgrading to v1.6.5 or using the custom odi-17 branch with fixes for bootstrap's actions/providers.

**Release Strategy**: The core development team discussed rushing out a v1.7.0 release with critical fixes, though compatibility issues with the Discord plugin necessitated additional testing and coordination.

### Cloud Infrastructure and Performance Optimization

Stan identified multiple opportunities to improve latency on the monorepo and planned several PRs addressing:
- **TOCTOU Race Conditions**: Implementing a "deduct-before, reconcile-after" approach combined with deslop to handle Time-of-check to time-of-use race conditions in cloud infrastructure
- **Runtime Initialization**: Optimizing the initialization process for better performance
- **Gateway Architecture**: Discussion around Discord bridge implementation in the Jeju cloud branch, with Odilitime recommending simple event pumps with multiple daemon instances per service for scale. Voice connections were identified as needing higher priority/bandwidth event pumps than text connections.

### Development Contributions and Architecture

**New Contributor Onboarding**: aicodeflow, a blockchain + AI engineer, expressed interest in contributing to ElizaOS with focus on:
- Agent autonomy with constraints
- Onchain execution layers with explicit guardrails
- Prediction market templates
- Observability and accountability tooling
- Redesigning plugins as "skills" rather than just integrations
- Building market-aware agents focused on interpretation/state rather than execution

Odilitime directed them to the Spartan project (github.com/elizaos/spartan) for DeFi utilities and recommended exploring the plugin-based architecture at github.com/elizaos-plugins/.

**x402 Protocol Integration**: AlleyBoss announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), offering a simplified implementation approach.

### Database and Development Workflow

**Migration Issues**: Andrei Mitrea encountered database migration errors when running `elizaos start` a second time. The system blocked destructive migrations that would drop columns like "agent_id" and "room_id" from the worlds table. The solution was setting `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development. Additionally, Omid Sa recommended using `elizaos dev` instead of `elizaos start` for continuous monitoring during development.

**API Integration**: ElizaBAO faced a "Model not found" error when integrating ElizaOS cloud agents. The issue was resolved by using correct model parameter format with provider prefixes (e.g., `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash`).

### Token and Community Management

**Migration Eligibility**: Multiple users inquired about AI16Z to ElizaOS migration mechanics. Omid Sa clarified that purchases after the November 11 snapshot aren't eligible for migration, addressing confusion about potential returns.

**Contract Address Visibility**: Community members requested better visibility of contract addresses on official channels. Kenk noted the linktree would be updated to point to CoinGecko, though concerns were raised about the current discovery flow not working well for users.

**DegenAI Updates**: Multiple inquiries about DegenAI status were addressed by satsbased, confirming the new version hasn't shipped yet. BingBongBing noted significant GitHub activity and mentioned upcoming developments at a 1M market cap.

### Documentation and Content

**RSS Feeds and Dashboards**: jin shared RSS feed URLs for ElizaOS documentation and suggested creating a combined dashboard with multiple data sources. They also shared a GitHub workflow reference for documentation updates from GitHub Next's agentics repository.

**Content Accuracy**: The core team identified an incorrect fact about Eigenlayer appearing on their website that was being propagated by LLMs, deciding to omit it from future content.

**Development Tools**: A Cursor API limitation was revealed - using your own Claude API key in Cursor means you don't get the Cursor-optimized version where they implement tricks to improve output.

## Key Questions & Answers

**Q: Why does the Discord plugin show "No server ID found" errors?**  
A: This is due to the transition from serverId to messageServerId in v1.7.0; use v1.6.5 or the odi-17 branch (answered by Odilitime)

**Q: How do I run elizaos start without getting destructive migration errors?**  
A: Set ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true when starting: `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true elizaos start`. This is safe for local development. (answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")

**Q: What command should I use for continuous monitoring during development?**  
A: Use `elizaos dev` instead of `elizaos start` for continuous monitoring of code changes. (answered by Omid Sa)

**Q: How do I fix "Model not found" error when calling agent API endpoints?**  
A: Use provider prefix format for the model parameter: openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash. (answered by cjft)

**Q: If I buy AI16Z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (November 11), you can't migrate (answered by Omid Sa)

**Q: What changes have been made with DegenAI?**  
A: The new version hasn't shipped yet (answered by satsbased)

**Q: What are earning agents?**  
A: Agents that make you money (answered by satsbased)

**Q: How can I help with ElizaOS development?**  
A: Start by reading the code and asking questions; work on plugins from github.com/elizaos-plugins/ (answered by Odilitime)

**Q: Is the Babylon that a16z invested in related to ElizaOS?**  
A: Nope (answered by degenwtf)

**Q: Do we have a team or workspace on hackmd?**  
A: Yes - https://hackmd.io/@elizaos/book (answered by jin)

**Q: So each problematic connector would need its own gateway?**  
A: Direction is simple event pumps, and we'll need more than one daemon instance per service for scale. Voice connections need higher priority/bandwidth event pumps than text. (answered by Odilitime)

## Community Help & Collaboration

**Odilitime → aicodeflow**: Introduced new contributor to Spartan project and plugin-based architecture; suggested starting with existing plugins for DeFi utilities and agent autonomy work.

**! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" → Andrei Mitrea**: Resolved database migration error by providing environment variable solution (ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true) and explained it's safe for local development.

**Omid Sa → Andrei Mitrea**: Recommended using elizaos dev command instead of elizaos start for continuous monitoring during development.

**cjft → ElizaBAO**: Resolved "Model not found" API error by explaining correct model parameter format with provider prefixes.

**shaw → DigitalDiva**: Suggested creating minimal Discord.js hello world script to isolate permission issues from Discord developer portal for debugging server ID detection problems.

**Odilitime → DigitalDiva**: Identified serverId to messageServerId transition issue in v1.7.0; recommended v1.6.5 or created odi-17 branch with fixes.

**Casino → DigitalDiva**: Suggested limiting scope/permissions and working back to desired features for Discord bot permission problems.

**Kenk → aicodeflow**: Suggested connecting with Odilitime and mentioned upcoming open sessions for new contributors.

**Kenk → S_ling Clement**: Connected them with specific team member for liquidity management and market making partnership discussions.

**Odilitime → Stan ⚡**: Recommended reviewing the Jeju cloud branch which has Shaw's preferred implementation of the discord bridge.

**jin → Stan ⚡**: Confirmed existence of HackMD workspace and shared link to https://hackmd.io/@elizaos/book.

**satsbased → aicodeflow**: Directed new contributor to contribute to open source ElizaOS in the appropriate channel.

## Action Items

### Technical

- **Fix Discord plugin serverId to messageServerId transition issues in v1.7.0** (Mentioned by: Odilitime)
- **Test and finalize odi-17 branch fixes for bootstrap actions/providers compatibility with plugin-discord 1.3.3** (Mentioned by: Odilitime)
- **Rush out release with version 1.7.0 fix from PR #6333** (Mentioned by: Odilitime)
- **Test fix with various Discord branches and cut new Discord release** (Mentioned by: Odilitime)
- **Push multiple PRs for monorepo latency improvements** (Mentioned by: Stan ⚡)
- **Implement cloud fixes to handle TOCTOU race conditions using deduct-before, reconcile-after approach + deslop** (Mentioned by: Stan ⚡)
- **Complete runtime initialization optimizations** (Mentioned by: Stan ⚡)
- **Review and test Telegram plugin PR #22** (Mentioned by: Stan ⚡)
- **Review and test Discord plugin PR #41** (Mentioned by: Stan ⚡)
- **Investigate and fix Discord bot server ID detection issue causing "No server ID found 10" error** (Mentioned by: DigitalDiva)
- **Clean up embedding delegation on agent side to avoid hidden dependencies** (Mentioned by: aicodeflow)
- **Redesign plugins as "skills" rather than just integrations for better composability** (Mentioned by: aicodeflow)
- **Build market-aware agents focusing on interpretation/state instead of execution** (Mentioned by: aicodeflow)
- **Ship new version of DegenAI** (Mentioned by: meltingsnow, satsbased)

### Documentation

- **Update linktree to point to CoinGecko for contract address discovery** (Mentioned by: Kenk)
- **Improve contract address (CA) visibility on official channels and website** (Mentioned by: degenwtf, Broccolex)
- **Document x402 protocol integration with ElizaOS using @alleyboss/micropay-solana-x402-paywall library** (Mentioned by: AlleyBoss)
- **Document correct model parameter format with provider prefixes for API endpoints** (Mentioned by: cjft)
- **Document ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS flag usage and migration safety practices** (Mentioned by: ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")
- **Omit incorrect Eigenlayer fact from future content** (Mentioned by: Borko, sayonara)
- **Review cloud optimization documentation at https://hackmd.io/@0PzDTGXqRg6nOCDoEwaN-A/SyDNAAIVWe** (Mentioned by: Stan ⚡)

### Feature

- **Develop agent onchain execution layers with explicit guardrails** (Mentioned by: aicodeflow)
- **Create practical agent templates for prediction markets and event-driven systems** (Mentioned by: aicodeflow)
- **Build observability and accountability tooling for inspectable agent decisions** (Mentioned by: aicodeflow)
- **Implement application building capabilities for agents** (Mentioned by: Connor On-Chain)
- **Explore Polymarket-based agent plugins for prediction markets** (Mentioned by: meltingsnow)
- **Create combined RSS dashboard integrating multiple ElizaOS data sources** (Mentioned by: jin)