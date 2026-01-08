# elizaOS Discord - 2026-01-07

## Overall Discussion Highlights

### Critical Bug Fixes and Version 1.7.0 Issues

A major technical crisis emerged around ElizaOS version 1.7.0, requiring immediate attention from the core development team. DigitalDiva reported Discord bot integration failures with "No server ID found 10" errors related to the bootstrap plugin. Error logs revealed problems with the serverId to messageServerId migration in the plugin-discord component.

Odilitime diagnosed the root cause as incomplete fixes in the 1.7.0 core release, specifically compatibility issues between the bootstrap plugin's actions/providers and plugin-discord 1.3.3. He created a fix branch (odi-17) on GitHub with patches to resolve these compatibility issues and recommended either downgrading to core 1.6.5 or waiting for the branch to be fully tested. An urgent release was planned (PR #6333) to address these critical issues, though testing across multiple Discord branches remained necessary before cutting a new Discord release.

### Architectural Decisions for Scaling and Connectors

A significant architectural discussion unfolded in the core-devs channel regarding connector gateways and scaling strategies. Odilitime recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation. The conversation evolved into scaling considerations, with Odilitime proposing **simple event pumps** as the direction forward.

Key architectural decisions included:
- **Multiple daemon instances per service** to handle scale requirements
- **Differentiated event pumps** for voice connections (requiring higher bandwidth/priority) versus text connections
- **Preprocessing as an optimization strategy** for event handling
- Moving away from complex gateway architectures toward simpler event pump models

### Cloud Infrastructure and Race Condition Fixes

Stan provided a standup update detailing critical work on cloud fixes addressing **TOCTOU (Time-of-Check-Time-of-Use) race conditions** using a deduct-before, reconcile-after approach. He also worked on runtime initialization optimizations, creating corresponding Linear tickets for tracking. Stan submitted plugin PRs for Telegram (#22) and Discord (#41) and shared documentation for review on HackMD.

### API Integration and Model Configuration

ElizaBAO encountered a "Model not found" error when integrating elizaoscloud agents into their website using agent IDs and API endpoints. cjft provided the solution by explaining the correct format for the model parameter: using provider prefix formats like `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, or `google/gemini-2.5-flash`. This provider/model-name format was confirmed as the recommended approach.

### Community and Documentation Concerns

Multiple community members raised concerns about the discoverability of the ElizaOS contract address. Broccolex and degenwtf flagged that the current flow makes it too difficult for users to find the correct CA within 10 seconds. Kenk mentioned the linktree is being refreshed to point to CoinGecko for token information, and shaw confirmed the team would address posting the contract address across all official X accounts.

Jin shared valuable resources including the ElizaOS book documentation on HackMD and a GitHub resource from githubnext/agentics regarding workflow documentation for updating docs.

### Token Migration Questions

Nancy asked about ai16z migration timing, with Omid Sa clarifying that purchases made after the November 11 snapshot are not eligible for migration.

## Key Questions & Answers

**Q: How should I format the model parameter when calling agent API endpoints?**  
A: Use provider prefix format like `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, or `google/gemini-2.5-flash` (answered by cjft)

**Q: What version of ElizaOS are you using?**  
A: Version 1.7.0 with plugin-discord 1.3.3 (answered by DigitalDiva)

**Q: Does that mean I can keep this version?**  
A: You could try cloning the odi-17 branch which should work with plugin-discord 1.3.3, but still testing (answered by Odilitime)

**Q: Why hasn't the ElizaOS contract address been posted across all official X accounts?**  
A: The team will get on it (answered by shaw)

**Q: If I buy ai16z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (November 11) you can't migrate (answered by Omid Sa)

**Q: Do we have a team or workspace on hackmd?**  
A: Yes (answered by jin, sharing https://hackmd.io/@elizaos/book)

**Q: So each problematic connector would need its own gateway?**  
A: Direction is simple event pumps, and we'll need more than one daemon instance per service due to scale (answered by Odilitime)

**Q: Why does the agent need admin privileges?**  
A: DigitalDiva gave admin permissions when the bot wouldn't respond or see server ID and usernames (answered by DigitalDiva)

## Community Help & Collaboration

**shaw → DigitalDiva**  
Context: Discord bot not responding or seeing server IDs  
Resolution: Suggested creating minimal hello world script with discord.js to log server IDs and env vars, isolating permission issues from code issues

**Odilitime → DigitalDiva**  
Context: "No server ID found 10" error with ElizaOS 1.7.0 and bootstrap plugin  
Resolution: Diagnosed serverId to messageServerId migration issue, suggested downgrading to 1.6.5 or using fix branch odi-17, and created GitHub branch (odi-17) with fixes for bootstrap's actions/providers

**Casino → DigitalDiva**  
Context: Discord bot permission problems  
Resolution: Suggested limiting scope/permissions and working back to desired features

**cjft → ElizaBAO**  
Context: "Model not found" error when building elizaoscloud agents into website with agent IDs and API endpoints  
Resolution: Provided correct model parameter format using provider prefix (e.g., `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-flash`)

**Odilitime → Stan ⚡**  
Context: Stan working on Discord connector implementation  
Resolution: Recommended reviewing Jeju cloud branch with Shaw's preferred Discord bridge implementation at elizaOS/eliza-cloud-v2/tree/jeju/apps/discord-gateway

**jin → Stan ⚡**  
Context: Stan asking about HackMD team workspace  
Resolution: Confirmed existence and shared link to https://hackmd.io/@elizaos/book

**The Light → henry**  
Context: Need help migrating tokens held in Tangem at snapshot time  
Resolution: Directed to migration channel

**Kenk → S_ling Clement**  
Context: Looking to connect about liquidity management and market making partnerships  
Resolution: Suggested connecting with specific user for Voidix collaboration

## Action Items

### Technical

- **Rush out release with 1.7.0 fix from PR #6333** (Mentioned by: Odilitime)
- **Test Discord fix with various Discord branches and cut new Discord release** (Mentioned by: Odilitime)
- **Test and merge odi-17 branch fixes for bootstrap plugin compatibility with plugin-discord 1.3.3** (Mentioned by: Odilitime)
- **Complete serverId to messageServerId migration across ElizaOS codebase** (Mentioned by: Odilitime)
- **Review Telegram plugin PR #22** (Mentioned by: Stan ⚡)
- **Review Discord plugin PR #41** (Mentioned by: Stan ⚡)
- **Implement cloud fixes for TOCTOU race conditions using deduct-before, reconcile-after approach** (Mentioned by: Stan ⚡)
- **Optimize runtime initialization** (Mentioned by: Stan ⚡)
- **Plan scaling architecture for event pumps with multiple daemon instances per service** (Mentioned by: Odilitime)
- **Implement higher priority/bandwidth event pumps for voice connections versus text** (Mentioned by: Odilitime)
- **Implement preprocessing for event pumps** (Mentioned by: Odilitime)

### Documentation

- **Post ElizaOS contract address on official X accounts** (Mentioned by: degenwtf, shaw)
- **Refresh linktree to point to CoinGecko for token information** (Mentioned by: Kenk)
- **Make contract address findable within 10 seconds on website/Twitter** (Mentioned by: Broccolex)
- **Review documentation at https://hackmd.io/@0PzDTGXqRg6nOCDoEwaN-A/SyDNAAVWe** (Mentioned by: Stan ⚡)
- **Review agentics workflow documentation for updating docs at github.com/githubnext/agentics** (Mentioned by: jin)

### Feature

- **Explore Polymarket-based agent plugins following Predict post mention** (Mentioned by: meltingsnow)