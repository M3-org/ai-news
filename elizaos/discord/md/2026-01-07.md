# elizaOS Discord - 2026-01-07

## Overall Discussion Highlights

### Critical Bug Fixes and Version Management

The development team addressed critical issues in ElizaOS version 1.7.0, particularly affecting Discord bot integration. The core problem involved incomplete fixes in the transition from `serverId` to `messageServerId` in the codebase, causing "No server ID found 10" errors related to the bootstrap plugin. Odilitime created a fix branch (odi-17) on GitHub with corrections for bootstrap's actions and providers compatible with plugin-discord 1.3.3. An urgent release (PR #6333) was identified as necessary, though compatibility testing across multiple Discord branches remained essential before cutting a new Discord release.

### Architectural Decisions and Scaling Strategy

A significant architectural discussion emerged around connector gateways and scaling considerations. The team decided to move toward simple event pumps as the primary direction, with recognition that multiple daemon instances per service would be necessary to handle scale. Key differentiation was made between voice connections (requiring higher bandwidth/priority event pumps) and text connections, with preprocessing identified as a valuable optimization strategy. Odilitime recommended reviewing the Jeju cloud branch containing Shaw's preferred Discord bridge implementation as a reference.

### Cloud Infrastructure Improvements

Stan reported progress on cloud fixes addressing TOCTOU (Time-of-Check-Time-of-Use) race conditions using a deduct-before, reconcile-after approach, along with runtime initialization optimizations. These improvements aim to enhance the reliability and performance of the cloud infrastructure.

### API Integration and Model Configuration

A technical issue was resolved regarding ElizaOS cloud agent integration, where users encountered "Model not found" errors when calling API endpoints. The solution required proper model parameter formatting using provider-prefixed names (openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash) to ensure correct routing to AI model providers.

### Community and Documentation Concerns

Community members raised concerns about the visibility of the ElizaOS contract address (CA) across official channels, noting difficulty finding correct information. The team acknowledged this and committed to refreshing the linktree to point to CoinGecko for token information. Documentation resources were shared, including the ElizaOS book on HackMD and workflow documentation from githubnext/agentics.

## Key Questions & Answers

**Q: Why does the agent need admin privileges?**  
A: DigitalDiva gave admin permissions when the bot wouldn't respond or see server ID and usernames (Odilitime/DigitalDiva)

**Q: What version of ElizaOS should I use to avoid Discord integration issues?**  
A: Either downgrade to version 1.6.5 or use the odi-17 branch with fixes (Odilitime)

**Q: How should I format the model parameter when calling agent API endpoints?**  
A: Use provider prefix formats like openai/gpt-4o-mini, anthropic/claude-sonnet-4.5, or google/gemini-2.5-flash (cjft)

**Q: Do we have a team or workspace on HackMD?**  
A: Yes, the ElizaOS book is available at https://hackmd.io/@elizaos/book (jin)

**Q: Should each problematic connector have its own gateway?**  
A: The direction is simple event pumps, with multiple daemon instances per service needed for scale (Odilitime)

**Q: If I buy ai16z now and migrate after 30 days, will I get 120X?**  
A: If you buy after the snapshot (November 11), you can't migrate (Omid Sa)

**Q: Why hasn't the ElizaOS contract address been posted across all official X accounts?**  
A: The team will address this, and the linktree is being refreshed to point to CoinGecko (shaw and Kenk)

## Community Help & Collaboration

**Discord Bot Integration Support**
- **Odilitime** helped **DigitalDiva** diagnose and resolve "No server ID found 10" errors by identifying the serverId to messageServerId transition problem, recommending either downgrading to version 1.6.5 or using the newly created odi-17 fix branch
- **shaw** assisted **DigitalDiva** by suggesting creation of a minimal hello world script with discord.js to test if the issue was permission-related in the Discord developer portal
- **Casino** advised **DigitalDiva** to limit scope/permissions and work back to desired features when troubleshooting Discord bot problems

**API Integration Assistance**
- **cjft** resolved **ElizaBAO's** "Model not found" error by providing correct model parameter formatting with provider prefixes for API endpoint calls

**Architecture Guidance**
- **Odilitime** guided **Stan** on Discord connector implementation by recommending review of the Jeju cloud branch with Shaw's preferred Discord bridge implementation

**Documentation and Resources**
- **jin** confirmed HackMD team workspace availability for **Stan** and shared the ElizaOS book workspace link

**Community Connections**
- **Kenk** directed **S_ling Clement** to connect with a specific user for liquidity management collaboration discussions
- **The Light** directed **henry** to the migration support channel for help with tokens held in Tangem at snapshot time

## Action Items

### Technical

- **Fix bootstrap plugin serverId to messageServerId transition issues in ElizaOS 1.7.0** - Mentioned by Odilitime
- **Rush out release with fix from PR #6333 for version 1.7.0** - Mentioned by Odilitime
- **Test Discord fix with various Discord branches to resolve compatibility issues with Discord 1.3.3** - Mentioned by Odilitime
- **Cut new Discord release after branch testing** - Mentioned by Odilitime
- **Test and finalize odi-17 branch fixes for bootstrap actions/providers compatibility with plugin-discord 1.3.3** - Mentioned by Odilitime
- **Implement cloud fixes for TOCTOU race conditions using deduct-before, reconcile-after approach** - Mentioned by Stan ⚡
- **Complete runtime initialization optimizations** - Mentioned by Stan ⚡
- **Plan scaling architecture for multiple daemon instances per service** - Mentioned by Odilitime
- **Design higher priority/bandwidth event pumps for voice connections versus text** - Mentioned by Odilitime

### Documentation

- **Improve visibility and accessibility of ElizaOS contract address on official channels** - Mentioned by degenwtf, Broccolex
- **Refresh linktree to point to CoinGecko for token information** - Mentioned by Kenk
- **Review and potentially implement patterns from githubnext/agentics update-docs workflow** - Mentioned by jin
- **Review documentation at https://hackmd.io/@0PzDTGXqRg6nOCDoEwaN-A/SyDNAAIVWe** - Mentioned by Stan ⚡

### Feature

- **Explore Polymarket-based agent plugins following Predict post mention** - Mentioned by meltingsnow