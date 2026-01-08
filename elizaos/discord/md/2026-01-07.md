# elizaOS Discord - 2026-01-07

## Overall Discussion Highlights

### Critical Bug Fixes and Version 1.7.0 Issues

ElizaOS version 1.7.0 introduced significant compatibility issues requiring urgent attention. The core development team identified critical bugs necessitating an emergency release (PR #6333). The primary issue involved incomplete serverId to messageServerId migration in the codebase, causing Discord bot integration failures.

**DigitalDiva** encountered "No server ID found 10" errors when running their Discord bot with ElizaOS 1.7.0 and the bootstrap plugin. **Odilitime** diagnosed the problem as stemming from incomplete fixes in the 1.7.0 core release, specifically compatibility issues between the bootstrap plugin's actions/providers and plugin-discord 1.3.3.

**Resolution approach:** Odilitime created a fix branch (odi-17) on GitHub with patches for bootstrap's actions/providers. He recommended users either downgrade to core version 1.6.5 or wait for the fixes to be tested and merged. The team planned to test the Discord fix across various Discord branches before cutting a new Discord release.

### Architectural Decisions for Scaling

A significant architectural discussion emerged in the core-devs channel regarding connector gateways and scaling strategies. **Odilitime** proposed moving toward simple event pumps as the primary direction, emphasizing the need for multiple daemon instances per service to handle scale effectively.

Key architectural considerations included:
- Differentiated requirements between voice connections (requiring higher bandwidth/priority event pumps) and text connections
- Preprocessing as a valuable optimization strategy
- Review of the Jeju cloud branch containing Shaw's preferred Discord bridge implementation

### Cloud Infrastructure Improvements

**Stan** provided a comprehensive standup update on cloud fixes addressing TOCTOU (Time-of-Check-Time-of-Use) race conditions. The solution implemented a deduct-before, reconcile-after approach, along with runtime initialization optimizations. Linear tickets were created to track these improvements.

### ElizaOS Cloud Integration

**ElizaBAO** encountered a "Model not found" error when integrating elizaoscloud agents into their website using agent IDs and API endpoints. **cjft** provided the solution: using provider prefix formats for the model parameter (e.g., openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash).

### Community Visibility and Documentation

Multiple community members raised concerns about the discoverability of the ElizaOS contract address (CA). **degenwtf** and **Broccolex** noted that users struggle to find the official CA on X/Twitter accounts, highlighting that the current discoverability flow doesn't work well for most users. **Kenk** mentioned the linktree is being refreshed to point to CoinGecko for token information, and **shaw** confirmed the team would address posting the CA across official channels.

**jin** shared valuable documentation resources, including the ElizaOS book on HackMD and a GitHub resource from githubnext/agentics regarding workflow documentation patterns.

### Plugin Development

**Stan** submitted two plugin PRs for review:
- Telegram plugin (#22)
- Discord plugin (#41)

He also shared documentation for review on HackMD, contributing to the team's collaborative documentation efforts.

### Token Migration Clarification

**nancy** asked about ai16z token migration timing. **Omid Sa** clarified that purchases made after the November 11 snapshot are not eligible for migration, addressing confusion about the 120X migration opportunity.

## Key Questions & Answers

**Q: Why does the agent need admin privileges?**  
A: DigitalDiva gave admin permissions when the bot wouldn't respond or see server ID and usernames (answered by DigitalDiva)

**Q: What version of ElizaOS are you using?**  
A: Version 1.7.0 (answered by DigitalDiva)

**Q: Should I use version 1.6.5 instead?**  
A: Yes, might be easier to use older core like 1.6.5, or use the odi-17 branch with fixes (answered by Odilitime)

**Q: Does the fix branch mean I can keep this version?**  
A: You could clone the odi-17 branch which should work with plugin-discord 1.3.3, but still testing (answered by Odilitime)

**Q: How do I fix "Model not found" error when building elizaoscloud agents to website with agent ID and API endpoints?**  
A: Use provider prefix format for the model parameter: openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash (answered by cjft)

**Q: Why hasn't the ElizaOS contract address been posted across all official X accounts?**  
A: The team will get on it (answered by shaw)

**Q: If I buy ai16z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (November 11) you can't migrate (answered by Omid Sa)

**Q: Is the Babylon that a16z invested in made by ElizaOS?**  
A: Nope (answered by degenwtf)

**Q: Do we have a team or workspace on hackmd?**  
A: Yes (answered by jin, sharing https://hackmd.io/@elizaos/book)

**Q: So each problematic connector would need its own gateway?**  
A: Direction is simple event pumps, and we'll need more than one daemon instance per service due to scale (answered by Odilitime)

## Community Help & Collaboration

**shaw helped DigitalDiva** with Discord bot integration issues by suggesting creation of a minimal hello world script with discord.js to isolate whether the problem was Discord portal permissions or code-related. He noted that Discord developer portal permission configuration is a common source of errors and recommended checking Discord dev portal permissions and logging environment variables.

**Odilitime helped DigitalDiva** diagnose the "No server ID found 10" error with ElizaOS 1.7.0 and bootstrap plugin. He identified the serverId to messageServerId migration issue, created a fix branch (odi-17) on GitHub, and suggested either downgrading to version 1.6.5 or using the fix branch.

**Casino helped DigitalDiva** with Discord bot permission problems by suggesting limiting scope/permissions and incrementally working back to desired features to isolate the issue.

**cjft helped ElizaBAO** resolve the "Model not found" error when integrating elizaoscloud agents by providing the correct model parameter format using provider prefixes.

**Odilitime helped Stan** with Discord connector implementation by recommending review of the Jeju cloud branch with Shaw's preferred Discord bridge implementation.

**jin helped Stan** by confirming the existence of a HackMD team workspace and sharing the link to the ElizaOS book workspace.

**Kenk helped S_ling Clement** by directing them to connect with a specific user for collaboration discussion regarding liquidity management.

## Action Items

### Technical

- **Rush out release with fix from PR #6333 for version 1.7.0** (Mentioned by: Odilitime)
- **Test and merge odi-17 branch fixes for bootstrap plugin compatibility with plugin-discord 1.3.3** (Mentioned by: Odilitime)
- **Test Discord fix with various Discord branches to resolve compatibility issues with Discord 1.3.3** (Mentioned by: Odilitime)
- **Cut new Discord release after branch testing** (Mentioned by: Odilitime)
- **Complete serverId to messageServerId migration across ElizaOS codebase** (Mentioned by: Odilitime)
- **Implement cloud fixes for TOCTOU race conditions using deduct-before, reconcile-after approach** (Mentioned by: Stan)
- **Complete runtime initialization optimizations** (Mentioned by: Stan)
- **Plan scaling architecture for multiple daemon instances per service** (Mentioned by: Odilitime)
- **Design higher priority/bandwidth event pumps for voice connections versus text** (Mentioned by: Odilitime)

### Documentation

- **Review and potentially incorporate workflow documentation patterns from github.com/githubnext/agentics/workflows/update-docs.md** (Mentioned by: jin)
- **Review documentation at https://hackmd.io/@0PzDTGXqRg6nOCDoEwaN-A/SyDNAAIVWe** (Mentioned by: Stan)
- **Improve discoverability of ElizaOS contract address on official channels** (Mentioned by: degenwtf, Broccolex)
- **Refresh linktree to point to CoinGecko for token information** (Mentioned by: Kenk)

### Feature

- **Post ElizaOS contract address on official X accounts** (Mentioned by: shaw)
- **Explore Polymarket-based agent plugins following Predict post mention** (Mentioned by: meltingsnow)