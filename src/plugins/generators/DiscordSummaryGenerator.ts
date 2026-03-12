import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { DiscordChannelRegistry } from "../storage/DiscordChannelRegistry";
import { ContentItem, SummaryItem, DiscordSummary, ActionItems, HelpInteractions, SummaryFaqs, DiscordRawData } from "../../types";
import { writeFile } from "../../helpers/fileHelper";
import { logger } from "../../helpers/cliHelper";

export interface DiscordSummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source: string;
  outputPath?: string;
}

export class DiscordSummaryGenerator {
  private provider: OpenAIProvider;
  private storage: SQLiteStorage;
  private summaryType: string;
  private source: string;
  private outputPath: string;
  private static readonly MIN_CHANNEL_MESSAGES = 3;
  private static readonly MIN_CHANNEL_HUMAN_USERS = 2;


  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AIProvider',
        required: true,
        description: 'AI Provider plugin for the generator to use to create the Daily Summary.'
      },
      {
        name: 'storage',
        type: 'StoragePlugin',
        required: true,
        description: 'Storage Plugin to store the generated Daily Summary.'
      },
      {
        name: 'summaryType',
        type: 'string',
        required: true,
        description: 'Type for summary to store in the database.'
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description: 'Specific source to generate the summary off.'
      },
      {
        name: 'outputPath',
        type: 'string',
        required: false,
        description: 'Location to store summary for md and json generation'
      }
    ]
  };

  /**
   * Creates a new instance of DiscordSummaryGenerator.
   * @param config - Configuration object containing provider, storage, and output settings
   */
  constructor(config: DiscordSummaryGeneratorConfig) {
    this.provider = config.provider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.source = config.source;
    this.outputPath = config.outputPath || './';
  }

  /**
   * Main entry point for content generation.
   * Generates summaries for the current day's content.
   * @returns Promise<void>
   */
  public async generateContent() {
    try {
      const today = new Date();
      // Check for summary created *within* the last 24 hours, using the correct summaryType
      const checkStartTimeEpoch = (today.getTime() - (24 * 60 * 60 * 1000)) / 1000;
      const checkEndTimeEpoch = today.getTime() / 1000;
      
      let summary: SummaryItem[] = await this.storage.getSummaryBetweenEpoch(
        checkStartTimeEpoch,
        checkEndTimeEpoch,
        this.summaryType
      );
      
      if (!summary || summary.length === 0) {
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        const dateStr = summaryDate.toISOString().slice(0, 10);
        
        logger.info(`Generating discord summary for ${dateStr}`);
        await this.generateAndStoreSummary(dateStr);
        logger.success(`Discord summary generation completed for ${dateStr}`);
      } else {
        logger.info(`Recent summary found (Count: ${summary.length}). Generation skipped.`);
      }
    } catch (error) {
      logger.error(`Error in generateContent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generates and stores a daily summary for a specific date.
   * Processes all Discord content items for the given date and generates
   * both channel-specific and consolidated daily summaries.
   * @param dateStr - ISO date string for which to generate the summary
   * @returns Promise<void>
   */
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
      // Set up time range for the requested date
      const targetDate = new Date(dateStr);
      const startTimeEpoch = Math.floor(targetDate.setUTCHours(0, 0, 0, 0) / 1000);
      const endTimeEpoch = startTimeEpoch + (24 * 60 * 60);
      
      // Fetch raw content for this date
      logger.info(`Fetching Discord content for ${dateStr} between ${new Date(startTimeEpoch * 1000).toISOString()} and ${new Date(endTimeEpoch * 1000).toISOString()}`);
      const contentItems = await this.storage.getContentItemsBetweenEpoch(
        startTimeEpoch, endTimeEpoch, this.source
      );
      
      if (contentItems.length === 0) {
        logger.warning(`No Discord content found for ${dateStr}`);
        return;
      }
      
      logger.info(`Found ${contentItems.length} raw content items`);
      
      // Group by channel and process each channel
      const channelItemsMap = this.groupByChannel(contentItems);
      const allChannelSummaries: DiscordSummary[] = [];

      // DB-driven channel filtering: check isMuted and aiRecommendation
      let channelRegistry: DiscordChannelRegistry | null = null;
      const db = this.storage.getDb();
      if (db) {
        channelRegistry = new DiscordChannelRegistry(db);
      }

      const channelSelection: {
        included: { channelId: string; channelName: string; reason: string }[];
        excluded: { channelId: string; channelName: string; reason: string }[];
      } = { included: [], excluded: [] };

      const channelsToProcess: { [channelId: string]: ContentItem[] } = {};

      for (const [channelId, items] of Object.entries(channelItemsMap)) {
        const channelName = items[0]?.metadata?.channelName || 'Unknown';
        const { messages, users } = this.combineRawData(items);
        const uniqueHumanUsers = new Set(
          messages
            .filter(message => {
              const user = users[message.uid];
              return user && !user.isBot;
            })
            .map(message => message.uid)
        ).size;

        if (messages.length === 0) {
          channelSelection.excluded.push({
            channelId,
            channelName,
            reason: 'No messages that day'
          });
          logger.info(`Skipping channel ${channelName} (${channelId}): no messages that day`);
          continue;
        }

        if (
          messages.length < DiscordSummaryGenerator.MIN_CHANNEL_MESSAGES ||
          uniqueHumanUsers < DiscordSummaryGenerator.MIN_CHANNEL_HUMAN_USERS
        ) {
          const reasonParts: string[] = [];
          if (messages.length < DiscordSummaryGenerator.MIN_CHANNEL_MESSAGES) {
            reasonParts.push(`${messages.length} message${messages.length === 1 ? '' : 's'}`);
          }
          if (uniqueHumanUsers < DiscordSummaryGenerator.MIN_CHANNEL_HUMAN_USERS) {
            reasonParts.push(`${uniqueHumanUsers} human user${uniqueHumanUsers === 1 ? '' : 's'}`);
          }
          channelSelection.excluded.push({
            channelId,
            channelName,
            reason: `Below threshold: ${reasonParts.join(', ')}`
          });
          logger.info(`Skipping low-signal channel ${channelName} (${channelId}): ${reasonParts.join(', ')}`);
          continue;
        }

        if (channelRegistry) {
          const channel = await channelRegistry.getChannelById(channelId);
          if (channel) {
            if (channel.isMuted) {
              channelSelection.excluded.push({ channelId, channelName, reason: 'Muted' });
              logger.info(`Skipping muted channel ${channelName} (${channelId})`);
              continue;
            }
            if (channel.aiRecommendation === 'SKIP') {
              channelSelection.excluded.push({
                channelId,
                channelName,
                reason: channel.aiReason || 'AI recommended skip'
              });
              logger.info(`Skipping AI-SKIP channel ${channelName} (${channelId}): ${channel.aiReason || 'no reason'}`);
              continue;
            }
          }
        }

        channelsToProcess[channelId] = items;
        channelSelection.included.push({
          channelId,
          channelName,
          reason: `Active channel: ${messages.length} messages, ${uniqueHumanUsers} human users`
        });
      }

      logger.info(`Processing ${Object.keys(channelsToProcess).length} channels (${channelSelection.excluded.length} excluded)`);
      for (const [channelId, items] of Object.entries(channelsToProcess)) {
        try {
          logger.info(`Processing channel ${channelId} with ${items.length} items`);
          const channelSummary = await this.processChannelData(items);

          if (channelSummary) {
            // Add channel ID to the summary for linking with stats
            allChannelSummaries.push({
              ...channelSummary,
              channelId
            });
          }
        } catch (error) {
          logger.error(`Error processing channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Generate combined summary file if we have channel summaries
      if (allChannelSummaries.length > 0) {
        await this.generateCombinedSummaryFiles(
          allChannelSummaries,
          dateStr,
          startTimeEpoch,
          contentItems
        );
      }
      
    } catch (error) {
      logger.error(`Error generating summary for ${dateStr}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Groups content items by their Discord channel ID.
   * @param items - Array of content items to group
   * @returns Object mapping channel IDs to arrays of content items
   * @private
   */
  private groupByChannel(items: ContentItem[]): { [channelId: string]: ContentItem[] } {
    const channels: { [channelId: string]: ContentItem[] } = {};
    
    for (const item of items) {
      if (item.metadata?.channelId) {
        const channelId = item.metadata.channelId;
        if (!channels[channelId]) {
          channels[channelId] = [];
        }
        channels[channelId].push(item);
      }
    }

    return channels;
  }

  /**
   * Process raw data for a single channel.
   * @param items - Content items for a single channel
   * @returns Promise<DiscordSummary | null> - Channel summary or null if processing fails
   * @private
   */
  private async processChannelData(items: ContentItem[]): Promise<DiscordSummary | null> {
    if (items.length === 0) {
      logger.warning("No items received");
      return null;
    }

    // Extract channel metadata
    const channelId = items[0]?.metadata?.channelId || 'unknown-channel';
    const guildName = items[0]?.metadata?.guildName || 'Unknown Server';
    const channelName = items[0]?.metadata?.channelName || 'Unknown Channel';
    
    // Parse and combine raw data
    const { messages, users } = this.combineRawData(items);
    
    if (messages.length === 0) {
      logger.warning(`No messages found for channel ${channelName} (${channelId})`);
      return null;
    }
    
    logger.info(`Combined data for ${channelName}: ${messages.length} messages, ${Object.keys(users).length} users`);
    
    // Get structured AI summary
    const structuredSummary = await this.getStructuredChannelSummary(messages, users, channelName);
    if (!structuredSummary) {
      logger.warning(`Failed to get AI summary for channel ${channelName}`);
      return null;
    }

    return {
      channelName,
      guildName,
      summary: structuredSummary.summary,
      faqs: structuredSummary.faqs || [],
      helpInteractions: structuredSummary.helpInteractions || [],
      actionItems: structuredSummary.actionItems || []
    };
  }

  /**
   * Combine raw data from multiple content items.
   * @param items - Array of content items to process
   * @returns Object with combined messages and users
   * @private
   */
  private combineRawData(items: ContentItem[]): {
    messages: DiscordRawData['messages'], 
    users: Record<string, DiscordRawData['users'][string]> 
  } {
    let allMessages: DiscordRawData['messages'] = [];
    let allUsers: Record<string, DiscordRawData['users'][string]> = {};
    
    for (const item of items) {
      try {
        if (item.type !== 'discordRawData' || !item.text) continue;
        
        const rawData: DiscordRawData = JSON.parse(item.text);
        
        if (rawData.messages && Array.isArray(rawData.messages)) {
          allMessages = allMessages.concat(rawData.messages);
        }
        
        if (rawData.users) {
          allUsers = { ...allUsers, ...rawData.users };
        }
      } catch (error) {
        logger.error(`Failed to parse item ${item.cid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Ensure messages are unique and sorted chronologically
    const uniqueMessages = Array.from(
      new Map(allMessages.map(m => [m.id, m])).values()
    ).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    
    return { messages: uniqueMessages, users: allUsers };
  }

  /**
   * Get AI summary for channel messages.
   * @param messages - Array of Discord messages
   * @param users - Map of user IDs to user data
   * @param channelName - Name of the channel
   * @returns Promise<string | null> - AI-generated summary or null if generation fails
   * @private
   */
  private async getStructuredChannelSummary(
    messages: DiscordRawData['messages'], 
    users: Record<string, DiscordRawData['users'][string]>,
    channelName: string
  ): Promise<{
    summary: string;
    faqs?: SummaryFaqs[];
    helpInteractions?: HelpInteractions[];
    actionItems?: ActionItems[];
  } | null> {
    try {
      // Format messages into a transcript
      const transcript = messages.map(msg => {
        const user = users[msg.uid];
        const username = user?.name || user?.nickname || msg.uid;
        const time = new Date(msg.ts).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
        return `[${time}] ${username}: ${msg.content}`;
      }).join('\n');
      
      logger.info(`Creating structured AI prompt for channel ${channelName} with ${messages.length} messages`);
      const prompt = this.getChannelSummaryPrompt(transcript, channelName);
      
      logger.info(`Calling AI provider for channel ${channelName} summary`);
      const response = await this.provider.summarizeStructured<{
        summary: string;
        faqs?: SummaryFaqs[];
        helpInteractions?: HelpInteractions[];
        actionItems?: ActionItems[];
      }>(prompt, 'discord_channel_summary', this.getChannelSummarySchema());
      logger.success(`Successfully received AI summary for channel ${channelName}`);

      return this.validateStructuredChannelSummary(response, channelName);
    } catch (error) {
      logger.error(`Error getting AI summary: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Format prompt for channel summary.
   * @param transcript - Chat transcript
   * @param channelName - Name of the channel
   * @returns Formatted prompt string
   * @private
   */
  private getChannelSummaryPrompt(transcript: string, channelName: string): string {
    return `Analyze this Discord chat segment for channel "${channelName}" and return only valid JSON.

Required field:
- "summary": concise but specific summary of the most important technical discussions, decisions, implementations, or community developments in this channel.

Optional fields:
- "faqs": only include if there are meaningful questions with real answers or clearly unanswered important questions.
- "helpInteractions": only include if there are concrete cases where one community member helped another.
- "actionItems": only include if there are meaningful technical, documentation, or feature follow-ups.

Rules:
- Omit optional keys entirely when there is no meaningful data.
- Do not include markdown, prose preamble, code fences, or explanatory text outside JSON.
- Do not invent structure for trivial chat.
- Be conservative: if the channel is low-signal, return only {"summary": "..."}.
- Preserve exact usernames where possible.

Chat transcript:
---
${transcript}
---`;
  }

  private getChannelSummarySchema(): Record<string, unknown> {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: {
        summary: { type: 'string', minLength: 1 },
        faqs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'askedBy', 'answeredBy'],
            properties: {
              question: { type: 'string', minLength: 1 },
              askedBy: { type: 'string', minLength: 1 },
              answeredBy: { type: 'string', minLength: 1 }
            }
          }
        },
        helpInteractions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['helper', 'helpee', 'context', 'resolution'],
            properties: {
              helper: { type: 'string', minLength: 1 },
              helpee: { type: 'string', minLength: 1 },
              context: { type: 'string', minLength: 1 },
              resolution: { type: 'string', minLength: 1 }
            }
          }
        },
        actionItems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'description', 'mentionedBy'],
            properties: {
              type: { type: 'string', enum: ['Technical', 'Documentation', 'Feature'] },
              description: { type: 'string', minLength: 1 },
              mentionedBy: { type: 'string', minLength: 1 }
            }
          }
        }
      }
    };
  }

  private validateStructuredChannelSummary(
    value: unknown,
    channelName: string
  ): {
    summary: string;
    faqs?: SummaryFaqs[];
    helpInteractions?: HelpInteractions[];
    actionItems?: ActionItems[];
  } {
    if (!value || typeof value !== 'object') {
      throw new Error(`Structured summary for ${channelName} was not an object`);
    }

    const record = value as Record<string, unknown>;
    if (typeof record.summary !== 'string' || !record.summary.trim()) {
      throw new Error(`Structured summary for ${channelName} missing summary`);
    }

    const result: {
      summary: string;
      faqs?: SummaryFaqs[];
      helpInteractions?: HelpInteractions[];
      actionItems?: ActionItems[];
    } = { summary: record.summary.trim() };

    if (record.faqs !== undefined) {
      if (!Array.isArray(record.faqs)) throw new Error(`Structured summary for ${channelName} has invalid faqs`);
      result.faqs = record.faqs.map((faq, index) => {
        const item = faq as Record<string, unknown>;
        if (typeof item.question !== 'string' || typeof item.askedBy !== 'string' || typeof item.answeredBy !== 'string') {
          throw new Error(`Structured summary for ${channelName} has invalid faqs[${index}]`);
        }
        return {
          question: item.question.trim(),
          askedBy: item.askedBy.trim(),
          answeredBy: item.answeredBy.trim()
        };
      }).filter(item => item.question && item.askedBy && item.answeredBy);
      if (result.faqs.length === 0) delete result.faqs;
    }

    if (record.helpInteractions !== undefined) {
      if (!Array.isArray(record.helpInteractions)) throw new Error(`Structured summary for ${channelName} has invalid helpInteractions`);
      result.helpInteractions = record.helpInteractions.map((interaction, index) => {
        const item = interaction as Record<string, unknown>;
        if (
          typeof item.helper !== 'string' ||
          typeof item.helpee !== 'string' ||
          typeof item.context !== 'string' ||
          typeof item.resolution !== 'string'
        ) {
          throw new Error(`Structured summary for ${channelName} has invalid helpInteractions[${index}]`);
        }
        return {
          helper: item.helper.trim(),
          helpee: item.helpee.trim(),
          context: item.context.trim(),
          resolution: item.resolution.trim()
        };
      }).filter(item => item.helper && item.helpee && item.context && item.resolution);
      if (result.helpInteractions.length === 0) delete result.helpInteractions;
    }

    if (record.actionItems !== undefined) {
      if (!Array.isArray(record.actionItems)) throw new Error(`Structured summary for ${channelName} has invalid actionItems`);
      result.actionItems = record.actionItems.map((action, index) => {
        const item = action as Record<string, unknown>;
        if (
          (item.type !== 'Technical' && item.type !== 'Documentation' && item.type !== 'Feature') ||
          typeof item.description !== 'string' ||
          typeof item.mentionedBy !== 'string'
        ) {
          throw new Error(`Structured summary for ${channelName} has invalid actionItems[${index}]`);
        }
        return {
          type: item.type,
          description: item.description.trim(),
          mentionedBy: item.mentionedBy.trim()
        } as ActionItems;
      }).filter(item => item.description && item.mentionedBy);
      if (result.actionItems.length === 0) delete result.actionItems;
    }

    return result;
  }

  /**
   * Calculate message and user statistics from content items.
   * @param contentItems - Array of content items
   * @returns Statistics object
   * @private
   */
  private calculateDiscordStats(contentItems: ContentItem[]): {
    totalMessages: number;
    totalUsers: number;
    channelStats: {
      channelId: string;
      channelName: string;
      messageCount: number;
      uniqueUsers: string[];
    }[];
  } {
    // Initialize stats
    const stats = {
      totalMessages: 0,
      totalUsers: 0,
      channelStats: [] as Array<{
        channelId: string;
        channelName: string;
        messageCount: number;
        uniqueUsers: string[];
      }>,
      allUniqueUsers: new Set<string>()
    };
    
    // Group by channel
    const channelMap = this.groupByChannel(contentItems);
    
    // Process each channel
    for (const [channelId, items] of Object.entries(channelMap)) {
      let channelMessageCount = 0;
      const channelUsers = new Set<string>();
      
      // Count messages and collect users
      items.forEach(item => {
        if (item.text && item.type === "discordRawData") {
          try {
            const data: DiscordRawData = JSON.parse(item.text);
            
            if (data.messages && Array.isArray(data.messages)) {
              channelMessageCount += data.messages.length;
              
              data.messages.forEach(msg => {
                if (msg.uid) {
                  channelUsers.add(msg.uid);
                  stats.allUniqueUsers.add(msg.uid);
                }
              });
            }
          } catch (e) {
            // Skip parsing errors
          }
        }
      });
      
      const channelName = items[0]?.metadata?.channelName || 'Unknown Channel';
      
      stats.channelStats.push({
        channelId,
        channelName,
        messageCount: channelMessageCount,
        uniqueUsers: Array.from(channelUsers)
      });
      
      stats.totalMessages += channelMessageCount;
    }
    
    stats.totalUsers = stats.allUniqueUsers.size;
    
    // Create a clean copy without the Set
    const { allUniqueUsers, ...cleanStats } = stats;
    return cleanStats;
  }

  /**
   * Generate combined summary files (JSON and Markdown)
   * @param summaries - Array of channel summaries
   * @param dateStr - Date string
   * @param timestamp - Unix timestamp
   * @param contentItems - Original content items for stats
   * @private
   */
  private async generateCombinedSummaryFiles(
    summaries: DiscordSummary[],
    dateStr: string,
    timestamp: number,
    contentItems: ContentItem[]
  ): Promise<void> {
    try {
      const serverName = summaries[0]?.guildName || "Discord Server";
      const fileTitle = `${serverName} Discord - ${dateStr}`;

      // Calculate statistics
      const stats = this.calculateDiscordStats(contentItems);

      // Collect global users map from content items
      const usersMap: Record<string, { name: string; nickname: string | null; isBot?: boolean }> = {};
      for (const item of contentItems) {
        if (item.type === 'discordRawData' && item.text) {
          try {
            const rawData: DiscordRawData = JSON.parse(item.text);
            if (rawData.users) {
              for (const [uid, user] of Object.entries(rawData.users)) {
                if (!usersMap[uid]) {
                  usersMap[uid] = { name: user.name, nickname: user.nickname, isBot: user.isBot };
                }
              }
            }
          } catch { /* skip parse errors */ }
        }
      }

      // Generate AI summary
      const markdownContent = await this.generateDailySummary(summaries, dateStr);

      // Create enhanced JSON data
      const jsonData: Record<string, any> = {
        server: serverName,
        title: fileTitle,
        date: timestamp,
        stats: {
          totalMessages: stats.totalMessages,
          totalUsers: stats.totalUsers
        },
        categories: summaries.map(s => {
          const channelStats = stats.channelStats.find(c => c.channelId === s.channelId);
          const category: Record<string, any> = {
            channelId: s.channelId || '',
            channelName: s.channelName || '',
            summary: s.summary || '',
            messageCount: channelStats?.messageCount || 0,
            userCount: channelStats?.uniqueUsers.length || 0
          };
          if (s.faqs && s.faqs.length > 0) category.faqs = s.faqs;
          if (s.helpInteractions && s.helpInteractions.length > 0) category.helpInteractions = s.helpInteractions;
          if (s.actionItems && s.actionItems.length > 0) category.actionItems = s.actionItems;
          return category;
        })
      };

      // Add users map for downstream nickname rendering
      if (Object.keys(usersMap).length > 0) {
        jsonData.users = usersMap;
      }
      
      // Prepare final markdown with title
      const finalMarkdown = `# ${fileTitle}\n\n${markdownContent.replace(/^#\s+[^\n]*\n/, '')}`;
      
      // Write files
      logger.info(`Writing combined summary files to ${this.outputPath}`);
      await writeFile(this.outputPath, `${dateStr}`, JSON.stringify(jsonData, null, 2), 'json');
      await writeFile(this.outputPath, `${dateStr}`, finalMarkdown, 'md');
      
      // Save to database summary table
      logger.info(`Saving combined summary to database`);
      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: fileTitle,
        categories: JSON.stringify(jsonData),  // Store the JSON data
        markdown: finalMarkdown,               // Store the markdown content
        date: timestamp
      };
      
      await this.storage.saveSummaryItem(summaryItem);
      logger.success(`Saved combined summary to database for ${dateStr}`);
      
      logger.success(`Generated combined summary files for ${dateStr}`);
    } catch (error) {
      logger.error(`Error generating combined summary files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a daily summary of all channel summaries using AI.
   * @param summaries - Array of channel summaries
   * @param dateStr - Date string
   * @returns AI-generated markdown summary
   * @private
   */
  private async generateDailySummary(
    summaries: DiscordSummary[], 
    dateStr: string
  ): Promise<string> {
    try {
      // Format context from channel summaries
      const promptContext = summaries
        .map(s => `### ${s.guildName} - ${s.channelName}\n${s.summary}`)
        .join('\n\n---\n');
      
      // Create prompt without triple backticks to avoid artifacts
      const prompt = `Create a comprehensive daily markdown summary of Discord discussions from ${dateStr}. 
Here are the channel summaries:

${promptContext}

Please structure the final output clearly, covering these points across all channels:
1. **Overall Discussion Highlights:** Key topics, technical decisions, and announcements. Group by theme rather than by channel.
2. **Key Questions & Answers:** List significant questions that received answers.
3. **Community Help & Collaboration:** Showcase important instances of users helping each other.
4. **Action Items:** Consolidate all action items, grouped by type (Technical, Documentation, Feature). Ensure attribution (mentioned by) is included.

Use markdown formatting effectively (headings, lists, bold text). Start your response directly with the markdown content, not with explanations or preamble.
Please note that the final output should be in a single, coherent document without any markdown code block formatting.`;
      
      logger.info(`Sending daily summary prompt to AI provider`);
      const result = await this.provider.summarize(prompt);
      logger.success(`Received daily summary from AI provider`);
      
      // Clean up potential artifacts
      return result
        .trim()
        .replace(/```markdown\n?|```\n?/g, '') // Remove markdown code block markers
        .replace(/^#+ .*\n{1,2}/m, '') // Remove any top-level heading line
    } catch (error) {
      logger.error(`Error generating daily summary: ${error instanceof Error ? error.message : String(error)}`);
      return `# Error Generating Summary\n\nUnable to generate summary: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
