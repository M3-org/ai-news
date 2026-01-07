# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Discord Plugin Issues & Version Compatibility

A major technical issue dominated discussions across multiple channels involving the Discord plugin in ElizaOS v1.7.0. DigitalDiva encountered critical bugs where the bot couldn't detect server ID, username, or server owner despite correct intent configurations and admin permissions. Error logs showed "No server ID found" with room.serverId returning undefined.

Odilitime identified the root cause as a transition from `serverId` to `messageServerId` in the codebase. He recommended either downgrading to v1.6.5 or using a custom branch (odi-17) with fixes for bootstrap's actions/providers. A bug fix was merged (PR #6333) in the core-devs channel, though concerns were raised about rushing the release. Compatibility issues persisted with Discord 1.3.3, requiring testing across multiple Discord branches and a new Discord release.

Shaw suggested debugging with a minimal Discord.js hello world script to isolate permission issues from the Discord developer portal, while Casino recommended limiting scope/permissions and working back to desired features.

### Database Migration & Development Workflow

Andrei Mitrea faced a database migration error when running `elizaos start` a second time. The system blocked destructive migrations that would drop columns like "agent_id" and "room_id" from the worlds table. The solution was to set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development. Omid Sa recommended using `elizaos dev` instead of `elizaos start` for continuous monitoring during development.

### Performance Optimization & Architecture

Stan identified multiple latency improvements for the monorepo and planned to submit several PRs with accompanying documentation. He's specifically working on:
- Cloud fixes to handle TOCTOU (Time-of-check to time-of-use) race conditions using a "deduct-before, reconcile-after" approach
- Runtime initialization optimizations requiring deeper testing and validation

Architecture discussions focused on connector gateways and scaling strategies. The team discussed moving toward simple event pumps with multiple daemon instances per service for scalability. Voice connections were identified as requiring higher priority/bandwidth event pumps compared to text, with preprocessing expected to provide significant benefits.

### ElizaOS Cloud Agent Integration

ElizaBAO encountered a "Model not found" error when integrating ElizaOS cloud agents into their website. cjft resolved this by explaining the correct model parameter format requires provider prefixes:
- `openai/gpt-4o-mini`
- `anthropic/claude-sonnet-4.5`
- `google/gemini-2.5-flash`

### Community Contributions & New Features

**aicodeflow**, a blockchain + AI engineer, expressed interest in contributing to ElizaOS with expertise in:
- Cleaning up embedding delegation to avoid hidden dependencies
- Redesigning plugins as "skills" rather than just integrations
- Building market-aware agents focused on interpretation/state rather than execution
- Agent autonomy with constraints and onchain execution layers with guardrails
- Prediction market templates and observability tooling

Odilitime directed them to the Spartan project (github.com/elizaos/spartan) for DeFi utilities and the plugin-based architecture at github.com/elizaos-plugins/.

**AlleyBoss** announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), offering a simplified implementation approach.

**Neo** released a Rust-inspired elizaOS implementation called zoey.xyz.

### Token & Migration Questions

Multiple users inquired about AI16Z to ElizaOS migration mechanics. Omid Sa clarified that purchases after the November 11 snapshot aren't eligible for migration. The community identified significant issues with contract address discoverability, with users struggling to find correct addresses across official channels. Kenk noted the linktree would be updated to point to CoinGecko, though Broccolex argued the current discovery flow is inadequate and should be findable within 10 seconds.

### DegenAI Status

Multiple users inquired about DegenAI updates. satsbased confirmed the new version hasn't shipped yet. BingBongBing noted significant GitHub activity on ElizaOS and mentioned upcoming DegenAI developments at a 1M market cap. Error P015-A suggested consolidating DegenAI functionality into ElizaOS for better utility.

### Documentation & Resources

jin shared valuable resources including:
- RSS feed URLs for ElizaOS documentation
- Suggestion for a combined dashboard with multiple data sources
- GitHub workflow reference for documentation updates from GitHub Next's agentics repository
- HackMD workspace link (https://hackmd.io/@elizaos/book)

## Key Questions & Answers

**Q: Why won't the Discord plugin see the server ID and username?**  
A: ElizaOS is moving from serverId to messageServerId in v1.7.0. Use v1.6.5 or try the odi-17 branch with fixes. *(answered by Odilitime)*

**Q: How do I run elizaos start without getting destructive migration errors?**  
A: Set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` when starting: `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true elizaos start` *(answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")*

**Q: What command should I use for continuous development monitoring?**  
A: Use `elizaos dev` instead of `elizaos start` for continuous monitoring. *(answered by Omid Sa)*

**Q: What's the correct model parameter format for ElizaOS cloud agent API endpoints?**  
A: Use provider prefix format like openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash. *(answered by cjft)*

**Q: How can I help with ElizaOS development?**  
A: Start by reading the code and working on plugins at github.com/elizaos-plugins/, the system is plugin-based. *(answered by Odilitime)*

**Q: If I buy AI16Z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (November 11) you can't migrate. *(answered by Omid Sa)*

**Q: Should each problematic connector have its own gateway?**  
A: Direction is simple event pumps, likely need more than one daemon instance per service for scale. *(answered by Odilitime)*

**Q: What are earning agents?**  
A: Agents that make you money. *(answered by satsbased)*

## Community Help & Collaboration

**Odilitime → DigitalDiva**: Identified the serverId to messageServerId transition issue causing Discord plugin errors, recommended v1.6.5 or created custom odi-17 branch with fixes for bootstrap actions/providers compatibility.

**shaw → DigitalDiva**: Suggested creating minimal hello world script with discord.js to isolate permission issues from Discord dev portal for the server ID detection problem.

**! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" → Andrei Mitrea**: Provided environment variable solution `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development to resolve destructive database migration errors.

**Omid Sa → Andrei Mitrea**: Recommended using `elizaos dev` command instead of `elizaos start` for continuous monitoring during code changes.

**cjft → ElizaBAO**: Explained correct model parameter format with provider prefixes (openai/, anthropic/, google/) to resolve "Model not found" error when calling agent API endpoints.

**Odilitime → aicodeflow**: Directed new contributor to Spartan project for DeFi utilities and explained plugin-based architecture for contributing to the ecosystem.

**Odilitime → Stan**: Recommended reviewing Jeju cloud branch with Shaw's preferred Discord bridge implementation for connector improvements.

**Casino → DigitalDiva**: Suggested limiting scope/permissions and working back to desired features for Discord bot permission problems.

**Kenk → aicodeflow**: Suggested connecting with Odilitime and mentioned upcoming open sessions for blockchain + AI engineer looking to contribute.

**jin → Stan**: Provided link to elizaOS hackmd book workspace when asked about team collaboration tools.

## Action Items

### Technical

- **Fix Discord plugin server ID detection issue in v1.7.0** related to serverId to messageServerId transition *(Odilitime)*
- **Test and finalize odi-17 branch fixes** for bootstrap actions/providers compatibility with plugin-discord 1.3.3 *(Odilitime)*
- **Rush out release with 1.7.0 fix** from PR #6333 *(Odilitime)*
- **Test Discord fix with various Discord branches** and cut new Discord release *(Odilitime)*
- **Investigate and fix Discord bot server ID detection issue** causing "No server ID found 10" error *(DigitalDiva)*
- **Push multiple PRs for monorepo latency improvements** *(Stan)*
- **Implement cloud fixes for TOCTOU race conditions** using deduct-before, reconcile-after approach *(Stan)*
- **Complete runtime initialization optimizations** with deeper testing and validation *(Stan)*
- **Plan scaling strategy for event pumps** with higher priority for voice connections vs text *(Odilitime)*
- **Develop agent onchain execution layers** with explicit guardrails for DeFi interactions *(aicodeflow)*
- **Build practical agent templates** for prediction markets and event-driven systems *(aicodeflow)*
- **Create observability and accountability tooling** for inspectable agent decisions *(aicodeflow)*
- **Clean up embedding delegation on agent side** to avoid hidden dependencies *(aicodeflow)*
- **Redesign plugins as "skills"** rather than just integrations for better composability *(aicodeflow)*
- **Build market-aware agents** focusing on interpretation/state instead of execution *(aicodeflow)*
- **Explore Polymarket-based agent plugins** following predict post mention *(meltingsnow)*

### Documentation

- **Document ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS flag usage** for development vs production *(! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")*
- **Document correct model parameter format** with provider prefixes for API endpoints *(cjft)*
- **Document difference between elizaos start and elizaos dev commands** *(Omid Sa)*
- **Review and provide feedback on latency optimization documentation** *(Stan)*
- **Update linktree to point to CoinGecko** for token information *(Kenk)*
- **Improve contract address discoverability** across official channels (website/Twitter) *(Broccolex)*
- **Post ElizaOS contract address across all official X accounts** *(degenwtf)*
- **Avoid repeating incorrect Eigenlayer information** in future content *(Borko)*

### Feature

- **Create combined RSS dashboard** integrating multiple ElizaOS data sources *(jin)*
- **Implement application building capability** for agents to use custom-built apps *(Connor On-Chain)*
- **Consider consolidating DegenAI utility into ElizaOS** *(Error P015-A)*