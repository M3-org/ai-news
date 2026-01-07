# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Discord Plugin Integration Issues

A major technical problem emerged with the Discord plugin in ElizaOS version 1.7.0. Users experienced errors where the bot couldn't detect server ID, username, or server owner despite proper intent configuration and admin permissions. The root cause was identified as a transition from `serverId` to `messageServerId` in the codebase.

**Resolution Path**: Odilitime diagnosed the issue and created a fix branch (odi-17) with updates to bootstrap's actions/providers to work with plugin-discord 1.3.3. However, the fix didn't work seamlessly with Discord 1.3.3, necessitating testing across various Discord branches and a new Discord release. The recommended workaround was to downgrade to core version 1.6.5 until the fixes were properly tested. A critical PR #6333 was identified for the 1.7.0 fix, with plans to rush out a release.

### Cloud Infrastructure and Performance Optimization

Stan identified multiple opportunities to improve monorepo latency and cloud infrastructure performance:

- **TOCTOU Race Conditions**: Implementing a "deduct-before, reconcile-after" approach combined with deslop to handle Time-of-check to time-of-use race conditions
- **Runtime Initialization**: Optimizing runtime initialization processes
- **Multiple PRs**: Planning to submit several PRs addressing these improvements

### Discord Gateway Architecture and Scaling

The team discussed implementing Discord bridges and scaling strategies:

- Odilitime recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation
- Discussion around event pump scaling, noting that voice connections would require higher priority/bandwidth event pumps compared to text
- Preprocessing was identified as beneficial for scaling
- Direction is toward simple event pumps, with acknowledgment that scale will require more than one daemon instance per service

### ElizaOS Cloud Integration

ElizaBAO encountered a "Model not found" error when integrating ElizaOS cloud agents into their website. The issue was resolved by cjft, who explained that the correct model parameter format requires provider prefixes (e.g., `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash`).

### New Contributor Onboarding

aicodeflow, a blockchain + AI engineer, introduced themselves with experience in AI agents with policy layers, risk limits, and onchain verification for DeFi. They offered expertise in three key areas:

1. Cleaning up embedding delegation to avoid hidden dependencies
2. Redesigning plugins as "skills" rather than just integrations for better composability
3. Building market-aware agents focusing on interpretation/state instead of execution

Odilitime directed them to the Spartan project and suggested starting with plugin-based development from github.com/elizaos-plugins/.

### Migration and Database Issues

Andrei Mitrea reported a destructive migration error when running `elizaos start` a second time. The system blocked migrations that would drop columns like "agent_id" and "room_id" from the worlds table. The solution was to set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development, with caution advised for production environments. Additionally, Omid Sa recommended using `elizaos dev` instead of `elizaos start` for continuous monitoring during development.

### Plugin Development Updates

- **x402 Protocol Integration**: AlleyBoss announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), offering a simplified implementation approach
- **Plugin PRs**: Stan submitted PRs for Telegram (#22) and Discord (#41) plugins, requesting feedback on documentation via HackMD

### Documentation and Content

- jin shared RSS feed URLs for ElizaOS documentation and suggested creating a combined dashboard with multiple data sources
- jin also shared a GitHub workflow reference for documentation updates from GitHub Next's agentics repository
- The team identified an incorrect fact that appeared on the Eigen website and was subsequently picked up by LLMs, discussing the need to avoid repeating it in other content

### Token and Project Updates

- Multiple users asked about AI16Z to ElizaOS migration mechanics and contract address visibility
- The team acknowledged difficulty in finding official contract addresses and committed to improving discoverability, with plans to update linktree to point to CoinGecko
- DegenAI discussion revealed it's still basic with a new version pending release, with a 1M market cap and upcoming features being developed
- BingBongBing noted significant GitHub activity on ElizaOS, suggesting strong development momentum

### Technical Insights

Odilitime shared findings from a Cursor call revealing that using your own Claude API key means you don't get Cursor's optimized version of Claude with their output improvements.

## Key Questions & Answers

**Q: Why won't the Discord plugin see the server ID and username?**  
A: This is because we're moving from serverId to messageServerId. The fixes are on the core side, might be easier to use an older core like 1.6.5. You could try and clone the odi-17 branch which should work with plugin-discord 1.3.3. *(answered by Odilitime)*

**Q: How do I run elizaos start without getting destructive migration errors?**  
A: Set ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true when starting, safe for local development but review carefully for production. *(answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")*

**Q: What command should I use for continuous monitoring during development?**  
A: Use elizaos dev command instead of elizaos start. *(answered by Omid Sa)*

**Q: What's the correct format for model parameters when calling agent API endpoints?**  
A: Use provider prefix format like openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash. *(answered by cjft)*

**Q: What changes have been made with degenai?**  
A: The new version is yet to be shipped. *(answered by satsbased)*

**Q: What are earning agents?**  
A: Agents that make you money. *(answered by satsbased)*

**Q: If I buy $ai16z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (11 November) you can't migrate. *(answered by Omid Sa)*

**Q: Do we have a team or workspace on hackmd?**  
A: Yes, https://hackmd.io/@elizaos/book *(answered by jin)*

**Q: Should each problematic connector need its own gateway?**  
A: Direction is simple event pumps, and due to scale will need more than one daemon instance per service. *(answered by Odilitime)*

## Community Help & Collaboration

**Discord Plugin Debugging** - Odilitime, shaw, and Casino helped DigitalDiva troubleshoot Discord plugin issues by identifying the serverId to messageServerId transition problem, creating fix branch odi-17, and recommending version 1.6.5 as a workaround. Shaw also suggested creating a simple hello world script with discord.js to test permissions and env vars separately from Eliza.

**New Contributor Guidance** - satsbased and Kenk welcomed aicodeflow to the project, directing them to contribute to open source ElizaOS in the dev channel. Odilitime provided specific guidance to work on the Spartan project and suggested reading code and working on plugins from github.com/elizaos-plugins/. Kenk mentioned upcoming open sessions for collaboration.

**Migration Support** - The Light directed henry to the migration support channel for help migrating tokens held in Tangem at time of snapshot.

**Database Migration Assistance** - ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" helped Andrei Mitrea resolve destructive migration errors by explaining the ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS flag and its safe usage for local development.

**Cloud Integration Support** - cjft helped ElizaBAO resolve "Model not found" errors by providing the correct model parameter format with provider prefixes.

**Discord Bridge Implementation** - Odilitime helped Stan by recommending review of the Jeju cloud branch with Shaw's preferred Discord bridge implementation and providing the repository link.

**HackMD Workspace** - jin helped Stan find the team workspace on HackMD by providing the elizaOS book link.

**Partnership Connections** - Kenk helped S_ling Clement connect with specific users for liquidity management and market making partnerships.

## Action Items

### Technical

- Fix Discord plugin serverId to messageServerId transition issues in ElizaOS 1.7.0 core *(Odilitime)*
- Test and merge odi-17 branch fixes for bootstrap's actions/providers to work with plugin-discord 1.3.3 *(Odilitime)*
- Rush out release with 1.7.0 fix from PR #6333 *(Odilitime)*
- Test Discord fix with various Discord branches and cut new Discord release *(Odilitime)*
- Investigate and fix Discord bot server ID detection issue causing "No server ID found 10" error *(DigitalDiva)*
- Submit multiple PRs for monorepo latency improvements *(Stan ⚡)*
- Implement cloud fixes for TOCTOU race conditions using deduct-before, reconcile-after approach *(Stan ⚡)*
- Complete runtime initialization optimizations *(Stan ⚡)*
- Review and test Telegram plugin PR #22 *(Stan ⚡)*
- Review and test Discord plugin PR #41 *(Stan ⚡)*
- Plan scaling strategy for event pumps with higher priority for voice connections vs text *(Odilitime)*
- Ship new version of degenai with upcoming features *(satsbased)*
- Clean up embedding delegation on agent side to avoid hidden dependencies *(aicodeflow)*
- Redesign plugins as "skills" rather than just integrations for better composability *(aicodeflow)*
- Build market-aware agents focusing on interpretation/state instead of execution *(aicodeflow)*

### Documentation

- Update linktree to point to CoinGecko for easier contract address discovery *(Kenk)*
- Improve discoverability of official contract addresses on website/social media *(Broccolex)*
- Post ElizaOS contract address across all official X accounts *(degenwtf)*
- Document ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS flag usage and migration safety practices *(! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")*
- Document elizaos dev command for development workflow *(Omid Sa)*
- Document correct model parameter format with provider prefixes for API endpoints *(cjft)*
- Review and provide feedback on cloud optimization documentation at https://hackmd.io/@0PzDTGXqRg6nOCDoEwaN-A/SyDNAAiVWe *(Stan ⚡)*
- Avoid repeating incorrect fact from Eigen website in other content *(Borko)*

### Feature

- Implement application building functionality for agents *(Connor On-Chain)*
- Develop agent execution layers with explicit guardrails for onchain interactions *(aicodeflow)*
- Create practical agent templates for prediction markets and event-driven systems *(aicodeflow)*
- Build observability and accountability tooling for inspectable agent decisions *(aicodeflow)*
- Explore Polymarket-based agent plugins for prediction markets *(meltingsnow)*
- Refine RSS pipeline and combine feeds into dashboard with additional data sources *(jin)*