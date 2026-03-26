# Community Member Profiles — System Overview

This document describes how we collect Discord community data, what we extract from it, how member profiles are generated, and where the current system has gaps. Written for external review and feedback.

---

## What We Collect

### Source: Discord Chat Logs

We ingest raw Discord message history across all channels in a server. For each channel per day we store:

- **Messages** — text content, author ID, timestamp, reply references, reactions, @mentions
- **Users** — Discord user ID, username, display name (nickname), roles, bot flag
- **Threads** — thread participation and message counts

This raw data is stored in a SQLite database per server. The M3 Metaverse Makers server has data from **April 2018 to present** — roughly 8 years.

### Per-User Registry

From the raw logs we build a `discord_users` table tracking:

- User ID, username, all historical nicknames with date ranges
- Roles held over time
- Total message count
- First seen / last seen dates
- Avatar URL

---

## What We Extract (AI Pass)

Each day's raw logs are processed by an LLM (GPT-4o-mini via OpenRouter) to extract structured data per channel:

### FAQs
Questions that came up in conversation, who asked, and who answered.

```json
{
  "question": "How do I export avatars from Blender to VRM format?",
  "askedBy": "someuser",
  "answeredBy": "anotheruser"
}
```

### Help Interactions
Direct help exchanges with context and resolution.

```json
{
  "helper": "avaer",
  "helpee": "jin",
  "context": "Jin asked about live lens undistortion for dual-lens VR",
  "resolution": "avaer explained the shader approach and linked relevant code"
}
```

### Action Items
Tasks, proposals, and goals attributed to specific people — categorized as Technical, Feature, or Documentation.

```json
{
  "type": "Technical",
  "description": "Investigate WebGL memory leak in Exokit avatar loader",
  "mentionedBy": "jin"
}
```

These three structured arrays are stored per channel per day in the daily JSON summaries at `output/<server>/summaries/json/YYYY-MM-DD.json`.

---

## How Profiles Are Generated

Profiles are built by running `npm run users -- generate-profiles --source=<server>.json` after accumulating daily summaries.

### Step 1 — Aggregate across all dates

For each display name that appears in the structured data, we collect across all available daily JSONs:

| Signal | Source |
|--------|--------|
| `helpGiven` | All interactions where they were the `helper` |
| `helpReceived` | All interactions where they were the `helpee` |
| `questionsAsked` | All FAQs where they were `askedBy` |
| `questionsAnswered` | All FAQs where they were `answeredBy` |
| `actionItems` | All items where `mentionedBy` includes their name |
| `activeDates` | Dates they appeared in the nicknameMap |

### Step 2 — Sample across the full date range

Rather than taking the most recent N items (which would bias toward recent activity), we split each array into three buckets — early, mid, recent — and sample evenly from each. This ensures the profile reflects the full arc of someone's activity, not just what they were doing last month.

Sample sizes scale by activity tier:
- **Core** (30+ active days): 20 help samples, 25 action items, 15 questions
- **Regular** (5–29 days): 12 / 15 / 10
- **Casual** (<5 days): 6 / 8 / 5

### Step 3 — Generate structured profile via LLM

The sampled evidence is sent to GPT-4o-mini with a journalist-style prompt: *"objective, grounded in evidence, no speculation, no flattery."* The model outputs a structured markdown document with fixed sections (see example below).

### Step 4 — Delta updates

Re-running `generate-profiles` on a profile that already exists triggers a delta pass: the existing profile + new evidence is sent to the LLM with instructions to update each section, correct outdated claims, and note any shifts in focus over time. This means profiles accumulate intelligence as more historical data is processed — they don't reset.

### Step 5 — Inject into daily summaries

The prose from `discord_users.notes` is injected into each day's `nicknameMap` as a `profile` field. When an LLM reads a daily summary and encounters a name, it has immediate context about who that person is.

---

## Profile Format

Each profile is a markdown file at `output/<server>/summaries/users/<displayName>.md` with YAML frontmatter (machine-readable stats) and structured prose sections.

### Example — jin (dankvr)

```markdown
---
userId: "213767993153290250"
username: "dankvr"
displayName: "jin"
roles: ["Owner", "M3", "Writer", "Dev", "Designer", "advisor", "devops", "🏘 Community"]
activityTier: "core"
generatedAt: "2026-03-22"
dateRange: "2018-07-01/2026-03-19"
helpGiven: 620
helpReceived: 304
questionsAsked: 1039
questionsAnswered: 822
actionItems: {Technical: 678, Feature: 727, Documentation: 341}
activeDays: 425
totalMessages: 224105
---

## Bio
- Jin, known by the Discord username "dankvr," has been active in the community from July 1, 2018, to March 19, 2026.
- He holds multiple roles, including Owner, M3, Writer, Developer, Designer, and Community Advisor.
- Over his tenure, he has contributed a total of 224,105 messages to the server.
- Jin is characterized as a helper and questioner, frequently assisting others while also seeking information and clarification on various topics.

## Domains & Skills
- Real-time camera-based mesh texturing using Meshroom and Blender
- Cross-platform asset portability and NFT features in CryptoVoxels
- 3D modeling and rendering techniques, including avatar workflows in VRM and Blender
- Documentation and community engagement strategies for metaverse technologies
- Technical troubleshooting for VR platforms such as Exokit and JanusVR
- Integration of blockchain technologies and smart contracts in virtual environments

## Communication Style
Jin's communication is marked by a technical depth that reflects his expertise in virtual environments and blockchain technologies. He often employs a straightforward vocabulary register, asking specific, detail-oriented questions and providing structured, actionable answers. His voice can be described as analytical, inquisitive, and supportive.

## Characteristic Questions & Quotes
- "Can you type into the URL bar with a keyboard?" (2018-07)
- "What resources are available for ENS integration?" (2019-09)
- "Is Arweave a competitor to Filecoin?" (2019-11)
- "What does avaer mean by 'smoke coins or unity'?" (2020-02)
- "Should people be taking vitamin D during quarantine?" (2020-03)

## Problems & Challenges
- Technical issues with URL bar input and application crashes in Exokit.
- Challenges related to optimizing asset exports for compatibility across different engines.
- Seeking resources and examples for integrating various blockchain technologies and virtual goods.
- Difficulty in navigating and utilizing existing VR tools and overlays effectively.

## Goals & Projects
- Technical: Develop a local-first cyberspace home concept; investigate and fix rendering issues on mobile devices; create a DApp for tokenized contracting.
- Feature: Implement creative kick animations for user removal; add support for animated textures on avatars; explore cross-blockchain interoperability.
- Documentation: Publish collaborative research on avatar standards; improve documentation regarding new API developments; review NFT guides for community education.

## Help Patterns
**Gives:** Jin reliably helps others with technical guidance on 3D modeling, asset portability, and troubleshooting VR platform issues, often providing concrete resources and examples.
**Receives:** He seeks assistance primarily for technical challenges related to VR tools, asset optimization, and understanding blockchain integrations in virtual environments.

## Temporal Arc
In the early phase (2018-2019), Jin focused on foundational support and troubleshooting for emerging VR technologies. In the mid-phase (2020-2021), contributions shifted toward more complex technical projects and documentation, reflecting deepening engagement with community needs. In the recent phase (2022-2026), he has taken on a more organizational role, emphasizing collaborative projects and cross-platform interoperability.
```

---

## Current Gaps

### Data gaps

**No resolution signal on help interactions.** We know who helped whom and what the context was, but we don't know if the help actually worked. Discord reactions (✅, 👍) from the original asker are a strong "resolved" signal — we have reaction data in the raw logs but don't currently use it.

**Action items are never closed.** We extract action items attributed to people but have no mechanism to detect when they're completed. A task mentioned in 2022 looks identical to one mentioned yesterday. GitHub commit/PR data (which we also collect) could provide weak completion signals.

**Nickname changes break attribution.** Someone who went by "jin" in 2018 and "jin (he/him)" in 2023 gets treated as two people during aggregation. We track nickname history with date ranges in the registry but don't yet use it to merge activity under a canonical identity.

**No reaction or reply graph.** We don't extract who replied to whom or who reacted to whose messages. These are high-value signals for understanding expertise (being @-mentioned when someone has a question) and answer quality (reactions on answers).

### Profile quality gaps

**Quotes are questions, not statements.** The most extractable verbatim text we have is questions asked — which is useful for voice, but misses how someone *explains* things. Actual message content isn't passed to the profile generator, only AI-summarized interaction descriptions.

**Profile is based on extracted summaries, not raw messages.** The FAQ/help/action item extraction is one LLM pass; the profile is a second LLM pass on top of that. Errors and omissions in the first pass compound. A person who is active but doesn't appear in help interactions or action items (e.g. a lurker who occasionally shares links) would have a thin profile despite real community value.

**No sentiment or energy signal.** Whether someone is consistently enthusiastic, frequently frustrated, or going through a difficult period isn't captured. This kind of context matters for governance and retrospective analysis.

**Skills are prose, not structured tags.** The `## Domains & Skills` section is human-readable but not machine-queryable. A downstream process wanting to answer "who knows WebXR?" has to parse prose rather than filter a tag array.

### Scale gaps

**Only one server at a time.** Some members are active across multiple servers (M3, ElizaOS, Hyperfy). Profiles are per-server — there's no cross-server identity merge to get a complete picture of someone's contributions across the ecosystem.

**Profile generation requires prior summarization.** Profiles are only as good as the daily summaries that feed them. Running profiles before generating summaries for a full date range means you're working with incomplete data.

---

## What We're Thinking About Next

- **Skill tag extraction** — a flat `skills: []` array in frontmatter derived from the Domains & Skills section, enabling simple lookup without prose parsing
- **Reaction-based resolution scoring** — use existing reaction data to distinguish resolved vs unresolved help interactions
- **Cross-server identity merge** — link profiles across servers by username for ecosystem-wide contributor pictures
- **Unanswered question aggregation** — FAQs with `answeredBy: "Unanswered"` across all dates surface persistent community knowledge gaps and potential recruitment targets
- **Collaboration graph** — post-process all profiles to build weighted edges between people who frequently help each other, once the full date range is summarized

---

*Generated from the [ai-news](https://github.com/M3-org/ai-news) pipeline. Data covers the M3 Metaverse Makers Discord server (guild 433492168825634816).*
