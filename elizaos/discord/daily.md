# elizaOS Discord - 2026-01-08

## Overall Discussion Highlights

### Token Economics & Utility Concerns

The community expressed significant concerns about the elizaOS token's utility within the ecosystem. Multiple users questioned why the token isn't being used for payments, gas fees, or other practical applications. FoRever_BIG clarified that elizaOS wasn't built as a gas fee token, explaining that utility tokens typically provide access to products/services within a platform. However, the lack of clear documentation about token utility and contract addresses on official channels remained a point of frustration, with calls for better transparency and vision communication.

### Korean Exchange Delisting Crisis

A major development emerged regarding elizaOS being delisted from Korean exchanges (Bithumb, Coinone, Korbit) due to DAXA (Digital Asset Exchange Alliance) decisions. The cited reasons include:
- Lack of transparency in rebranding procedures from ai16z to elizaOS
- Failure to properly disclose material information affecting token value

**Timeline:**
- Trading support ends: February 12, 2026
- Deposit/withdrawal ends: March 12, 2026

Bithumb confirmed it will support the AI16Z to ELIZAOS token swap, though questions remain about whether elizaOS will be relisted after the delisting period.

### Migration Challenges

Multiple users reported technical issues with the ai16z to elizaOS token migration:
- "Max amount reached" errors in the migration portal
- Complications with LP token migration (SOL-AI16Z on Raydium)
- Users with tokens purchased before November 2025 facing uncertainty

Users were directed to migration support channels, with warnings issued about scammers attempting to exploit users seeking migration help.

### Technical Development & Infrastructure

**Bazaar Protocol & Jeju Integration:**
The bazaar protocol was clarified as a decentralized marketplace application running on Jeju - essentially "the appstore for agents." This represents a key infrastructure component for the elizaOS ecosystem.

**Data Collection & AI Training Innovation:**
An ambitious proposal emerged for collecting real-world data using Inertial Motion Capture (IMocap) suits across various professions (fishing, haircutting, fast food preparation, even battlefield operations). The economic model would:
- Workers wear mocap suits during their activities
- Movement data gets tokenized
- Workers earn royalties when AI/androids use their captured skills for inference
- Potential partnerships with employers like McDonald's to integrate mocap into uniforms

This connects to the broader vision of an Eliza Phone App where users share data in exchange for reputation points and contribute to LLM training.

**Context Graphs & Data Foundation:**
Foundation Capital's article on context graphs was highlighted, with emphasis on Eliza's strong data foundation. The technical gap identified is integrating high-quality insights from agentic workflows (daily, weekly, monthly) into last-mile applications like agents, webhooks, and apps.

**Infrastructure Issues:**
- elizacloud.ai documentation website reported as down
- Questions about database choices for Eliza Cloud container deployments (Pglite vs PostgreSQL - both confirmed to work)
- X API cost concerns ($200/month) for scraping functionality

### Market Insights

Agent Joshua provided analysis on inference markets, noting they are not particularly profitable based on observations from models offered on their platform and OpenRouter over the past year.

## Key Questions & Answers

**Q: For deploying in Elizacloud via containers should I use Pglite or PostgresSQL?** (asked by Omid Sa)  
**A:** Either will work (answered by cjft)

**Q: Why is elizaOS token not being used for payments or utility within the ecosystem?** (asked by stoikol)  
**A:** It wasn't built to be used as gas fee; utility tokens give access to products/services inside a platform (answered by FoRever_BIG)

**Q: Will Bithumb support the AI16Z to ELIZAOS token swap?** (asked by KARA)  
**A:** Yes, Bithumb has already announced it will support the token swap (answered by FoRever_BIG)

**Q: What is the bazaar protocol shown in the GitHub commit?** (asked by elizafan222)  
**A:** Bazaar is the decentralized marketplace application running on Jeju - the appstore for agents (answered by sb)

**Q: Why did Korean exchanges delist elizaOS?** (asked by Majid)  
**A:** Due to lack of transparency in rebranding procedures and failure to properly disclose material information affecting token value (answered by 주니)

## Community Help & Collaboration

**Migration Support & Scam Prevention:**
- Hexx 🌐 helped XXI_Rapax gain access to migration channels by directing them to #verify-here
- Hexx 🌐 reported a scammer (guidebt) attempting to contact users about migration and advised blocking
- FoRever_BIG and Hexx 🌐 directed Dabel to official migration support channels with warnings about potential scammers

**Technical Guidance:**
- cjft assisted Omid Sa with database selection for Eliza Cloud deployments
- sb explained the bazaar protocol to elizafan222 and directed aicodeflow to contribute in developer channels, noting elizaOS is open source

## Action Items

### Documentation
- **Create clear documentation explaining elizaOS token utility and use cases within the ecosystem** (mentioned by stoikol)
- **Add elizaOS contract address (CA) to official X account** (mentioned by degenwtf)
- **Clarify token-based vision and utility plans previously mentioned by team** (mentioned by stoikol)
- **Fix elizacloud.ai docs website that is currently down** (mentioned by Amir)

### Technical
- **Resolve migration issues for users with LP tokens (SOL-AI16Z on Raydium)** (mentioned by Dabel)
- **Fix "max amount reached" error in migration portal** (mentioned by Dabel)
- **Build context graph leveraging Eliza's strong data foundation** (mentioned by jin)
- **Integrate daily/weekly/monthly insights from agentic workflows into last mile applications (agents, webhooks, apps)** (mentioned by jin)

### Feature Development
- **Build an Eliza Phone App that lets people give Eliza access to their data for LLM training and earning reputation points** (mentioned by DorianD)
- **Develop agents that pay people IOUs to collect their data once Jeju integration works** (mentioned by DorianD)
- **Find cheap solution for mocap suits for data collection from various professions** (mentioned by DorianD)
- **Create tokenization system for mocap data where workers earn royalties from AI inference using their captured skills** (mentioned by DorianD)