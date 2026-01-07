# elizaOS Discord - 2026-01-06

## Overall Discussion Highlights

### Critical Discord Plugin Issues (v1.7.0)

A major technical focus across multiple channels involved Discord integration bugs in ElizaOS v1.7.0. **DigitalDiva** encountered persistent "No server ID found" errors despite correct permissions and intent configurations. **Odilitime** identified the root cause as a codebase transition from `serverId` to `messageServerId`, where `room.serverId` was returning undefined during message processing. 

**Resolution paths identified:**
- Downgrade to core v1.6.5 for stability
- Use custom odi-17 branch with fixes for bootstrap's actions/providers
- Test minimal Discord.js hello world scripts to isolate permission issues
- Limit scope/permissions initially and work back to desired features

A critical bug fix for v1.7.0 was merged (PR #6333) in the core-devs channel, though compatibility issues persisted with Discord 1.3.3, requiring testing across multiple Discord branches and a new Discord release.

### Performance & Architecture Improvements

**Stan** identified multiple latency improvements for the monorepo and planned several PRs with documentation:
- **Cloud fixes** for TOCTOU (Time-of-check to time-of-use) race conditions using a "deduct-before, reconcile-after" approach
- **Runtime initialization optimizations** to reduce startup latency
- **Connector gateway architecture** discussions around event pumps and scaling strategies

The team discussed scaling approaches, noting that voice connections will require higher priority/bandwidth event pumps compared to text, with preprocessing expected to provide significant benefits. **Odilitime** recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation.

### New Contributions & Developer Onboarding

**aicodeflow** introduced themselves as a blockchain/AI engineer offering expertise in:
- Cleaning up embedding delegation to avoid hidden dependencies in Anthropic/OpenAI configurations
- Redesigning plugins as "skills" rather than just integrations for better composability
- Building market-aware agents focused on interpretation/state instead of execution
- Agent autonomy with constraints and onchain execution layers with guardrails
- Prediction market templates and observability tooling

**Odilitime** directed them to the Spartan project (github.com/elizaos/spartan) for DeFi utilities and suggested starting with plugin-based contributions from github.com/elizaos-plugins/.

**AlleyBoss** announced an updated library for x402 protocol integration with ElizaOS (`@alleyboss/micropay-solana-x402-paywall`), offering a simplified implementation approach.

### Database Migration & Development Workflow

**Andrei Mitrea** faced destructive migration errors when running `elizaos start` a second time. The system blocked migrations that would drop columns like "agent_id" and "room_id" from the worlds table. **! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇"** provided the solution: set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` for local development (safe for dev but requires careful review in production). **Omid Sa** recommended using `elizaos dev` instead of `elizaos start` for continuous monitoring during development.

### API Integration & Model Configuration

**ElizaBAO** encountered "Model not found" errors when integrating ElizaOS cloud agents into their website. **cjft** resolved this by explaining the correct model parameter format requires provider prefixes:
- `openai/gpt-4o-mini`
- `anthropic/claude-sonnet-4.5`
- `google/gemini-2.5-flash`

### Token Migration & Marketing

Multiple discussions arose about contract address (CA) visibility. **degenwtf** questioned why the ElizaOS CA isn't posted on official X accounts. **Broccolex** and others argued it's too difficult for users to find, suggesting pinned tweets or website links. **Kenk** noted the linktree is being refreshed to point to CoinGecko. Migration questions arose regarding AI16Z to ElizaOS conversion ratios and snapshot dates (November 11).

### DegenAI & Project Updates

**meltingsnow** inquired about DegenAI updates. **satsbased** confirmed the new version hasn't shipped yet. **BingBongBing** noted significant GitHub activity on ElizaOS and mentioned upcoming DegenAI developments at 1M market cap.

### Documentation & Resources

**jin** shared RSS feed URLs for ElizaOS documentation and suggested creating a combined dashboard with multiple data sources. They also shared a GitHub workflow reference for documentation updates from GitHub Next's agentics repository and provided the hackmd workspace link (https://hackmd.io/@elizaos/book).

### Ecosystem News

The team shared updates on Nvidia's Rubin platform and a new Rust-inspired elizaOS rollout called zoey.xyz. A minor content correction issue was identified regarding incorrect facts on the Eigen website being propagated by LLMs.

## Key Questions & Answers

**Q: How do I run elizaos start without getting destructive migration errors?**  
A: Set `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` when starting: `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true elizaos start`. This is safe for local development but review migrations carefully for production. *(answered by ! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇")*

**Q: Why won't the Discord plugin see the server ID and username?**  
A: This is because we're moving from serverId to messageServerId; are you using develop branch of elizaos? *(answered by Odilitime)*

**Q: What version should I use to fix Discord plugin issues?**  
A: Might be easier to use an older core like 1.6.5 *(answered by Odilitime)*

**Q: How do I fix "Model not found" error when building ElizaOS cloud agents into a website?**  
A: Use the correct model parameter format with provider prefix like openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash *(answered by cjft)*

**Q: How can I help with ElizaOS development?**  
A: Start by reading the code and asking questions; work on plugins from github.com/elizaos-plugins/ *(answered by Odilitime)*

**Q: What are earning agents?**  
A: Agents that make you money *(answered by satsbased)*

**Q: If I buy AI16Z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (11 November) you can't migrate *(answered by Omid Sa)*

**Q: Is the Babylon that a16z invested in built by ElizaOS?**  
A: Nope *(answered by degenwtf)*

**Q: Do we have a team or workspace on hackmd?**  
A: Yes, https://hackmd.io/@elizaos/book *(answered by jin)*

**Q: What changes have been made with DegenAI?**  
A: The new version hasn't shipped yet *(answered by satsbased)*

## Community Help & Collaboration

**! "Ꚃ.ഡ𝑒𝒶𝓋𝑒𝓇" → Andrei Mitrea**  
Resolved destructive migration error by providing the `ELIZA_ALLOW_DESTRUCTIVE_MIGRATIONS=true` environment variable solution, explaining safe usage for local development versus production.

**Omid Sa → Andrei Mitrea**  
Improved development workflow by recommending `elizaos dev` command instead of `elizaos start` for continuous monitoring during development.

**Odilitime → DigitalDiva**  
Diagnosed Discord plugin serverId to messageServerId transition issue and provided multiple resolution paths including version downgrade and custom branch options.

**Odilitime → aicodeflow**  
Onboarded new blockchain/AI engineer contributor by introducing the Spartan project for DeFi utilities and directing to plugin-based contribution model.

**shaw → DigitalDiva**  
Suggested debugging approach using minimal Discord.js hello world script to isolate permission issues from Discord developer portal.

**Casino → DigitalDiva**  
Recommended limiting scope/permissions initially and working back to desired features for Discord bot configuration.

**cjft → ElizaBAO**  
Resolved API integration issue by explaining correct model parameter format with provider prefixes for cloud agent endpoints.

**Kenk → aicodeflow**  
Connected new contributor with Odilitime and mentioned upcoming open sessions for collaboration.

**Kenk → henry**  
Directed to migration-support channel for help with tokens held in Tangem at snapshot time.

**Kenk → S_ling Clement**  
Connected to specific team member for liquidity management and market making partnership discussions.

**jin → Stan**  
Provided hackmd workspace link for documentation collaboration.

**Odilitime → Stan**  
Recommended reviewing Jeju cloud branch with Shaw's preferred Discord bridge implementation for architecture guidance.

**satsbased → aicodeflow**  
Directed new contributor to #dev-chat channel for open source contributions.

## Action Items

### Technical

- **Fix Discord plugin serverId to messageServerId transition issues in ElizaOS v1.7.0** *(Odilitime)*
- **Test and finalize odi-17 branch fixes for bootstrap actions/providers compatibility with plugin-discord 1.3.3** *(Odilitime)*
- **Test 1.7.0 fix with various Discord branches and cut new Discord release** *(Odilitime)*
- **Investigate and fix "No server ID found 10" error in Discord message processing where room.serverId is undefined** *(DigitalDiva)*
- **Push multiple PRs for monorepo latency improvements** *(Stan)*
- **Implement cloud fixes for TOCTOU race conditions using deduct-before, reconcile-after approach** *(Stan)*
- **Complete runtime initialization optimizations** *(Stan)*
- **Review Jeju cloud branch Discord gateway implementation** *(Odilitime)*
- **Plan scaling strategy for event pumps to handle voice vs text connections with different priorities** *(Odilitime)*
- **Clean up embedding delegation on agent side to avoid hidden dependencies with Anthropic/OpenAI setups** *(aicodeflow)*
- **Redesign plugins as "skills" rather than just integrations for better composability** *(aicodeflow)*
- **Build market-aware agents focused on interpretation/state instead of execution** *(aicodeflow)*

### Feature

- **Implement application building functionality for agents to use custom-built apps** *(Connor On-Chain)*
- **Develop agent onchain execution layers with explicit guardrails** *(aicodeflow)*
- **Create practical agent templates for prediction markets and event-driven systems** *(aicodeflow)*
- **Build observability and accountability tooling for inspectable agent decisions** *(aicodeflow)*
- **Explore Polymarket-based agent plugins for prediction markets** *(meltingsnow)*
- **Refine RSS pipeline and combine feeds into dashboard with additional data sources** *(jin)*

### Documentation

- **Update linktree to point to CoinGecko for easier contract address discovery** *(Kenk)*
- **Post ElizaOS contract address on official X accounts or implement better CA discovery flow** *(shaw)*
- **Improve contract address visibility on website within 10 seconds of searching** *(Broccolex)*
- **Document correct model parameter format with provider prefixes for API endpoints** *(cjft)*
- **Document use of elizaos dev command for development workflow** *(Omid Sa)*
- **Review and provide feedback on cloud optimization documentation** *(Stan)*
- **Correct incorrect facts about Eigen that are being propagated by LLMs** *(sayonara)*