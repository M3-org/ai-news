// src/plugins/DailySummaryGenerator.ts

import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem } from "../../types";
import crypto from "crypto";

interface DailySummaryGeneratorConfig {
  openAiProvider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source: string;
}

export class DailySummaryGenerator {
  private openAiProvider: OpenAIProvider;
  private storage: SQLiteStorage;
  private summaryType: string;
  private source: string;

  constructor(config: DailySummaryGeneratorConfig) {
    this.openAiProvider = config.openAiProvider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.source = config.source;
  }

  
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
        const endTime = new Date().getTime() / 1000;
        const startTime = endTime - ( 60 * 60 * 24);
      const contentItems: ContentItem[] = await this.storage.getContentItemsBetweenEpoch(startTime, endTime, this.summaryType);

      if (contentItems.length === 0) {
        console.warn(`No content found for date ${dateStr} to generate summary.`);
        return;
      }

      // const groupedContent = thiss.groupContentByTopic(contentItems);
      const groupedContent = this.groupObjectsByTopics(contentItems);
      console.log(groupedContent )
      const prompt = this.createAIPrompt(groupedContent, dateStr);

      const summaryText = await this.openAiProvider.summarize(prompt);

      console.log( summaryText )
    //   const summaryItem: ContentItem = {
    //     type: this.summaryType,
    //     source: this.source,
    //     cid: this.computeCid(dateStr),
    //     title: `Daily Summary for ${dateStr}`,
    //     text: summaryText,
    //     date: new Date(dateStr).getTime() / 1000,
    //     metadata: {
    //       generated_at: new Date().toISOString(),
    //     },
    //   };

    //   await this.storage.saveContentItem(summaryItem);

      console.log(`Daily summary for ${dateStr} generated and stored successfully.`);
    } catch (error) {
      console.error(`Error generating daily summary for ${dateStr}:`, error);
    }
  }

  private groupObjectsByTopics(objects : any[]): any[] {
    const topicMap = new Map();

    // Build a map of topics to associated objects
    objects.forEach(obj => {
      if (obj.topics) {
        obj.topics.forEach((topic:any) => {
          let shortCase = topic.toLowerCase();
            if (!topicMap.has(shortCase)) {
                topicMap.set(shortCase, []);
            }
            topicMap.get(shortCase).push(obj);
        });
      }
    });

    // Convert the map to an array and sort by popularity (number of associated objects)
    const sortedTopics = Array.from(topicMap.entries()).sort((a, b) => b[1].length - a[1].length);
    console.log( sortedTopics )
    // Format the result to include all topics from associated objects
    return sortedTopics.map(([topic, associatedObjects]) => {
        const mergedTopics = new Set();
        associatedObjects.forEach((obj:any) => {
            obj.topics.forEach((t:any) => mergedTopics.add(t));
        });

        return {
            topic,
            objects: associatedObjects,
            allTopics: Array.from(mergedTopics)
        };
    });
  }

  
  private groupContentByTopic(items: ContentItem[]): Record<string, ContentItem[]> {
    const topicGroups: Record<string, ContentItem[]> = {};

    const uniqueTopics = new Set<string>();

    items.forEach(item => {
        try {
            let stringTopic : any = item?.topics;
          
            if ( stringTopic ) {
                let topics : any = JSON.parse(JSON.stringify(stringTopic))
                
                if (topics && topics.length > 0 && Array.isArray(topics) ) {
                    topics.forEach(topic => {
                        uniqueTopics.add(topic);
                    });
                }
            }
        }
        catch (e) {
            console.log(e)
        }
    });

    uniqueTopics.forEach(topic => {
      topicGroups[topic] = [];
    });

    topicGroups["Miscellaneous"] = [];

    items.forEach(item => {
      const itemTopics = item.topics;
      if (itemTopics && Array.isArray(itemTopics) && itemTopics.length > 0) {
        itemTopics.forEach(topic => {
          const trimmedTopic = topic.trim();
          if (topicGroups[trimmedTopic]) {
            topicGroups[trimmedTopic].push(item);
          } else {
            // If topic wasn't in uniqueTopics for some reason, assign to Miscellaneous
            topicGroups["Miscellaneous"].push(item);
          }
        });
      } else {
        // Assign to Miscellaneous if no topics are present
        topicGroups["Miscellaneous"].push(item);
      }
    });

    console.log( topicGroups )
    return topicGroups;
  }

  private createAIPrompt(groupedContent: Record<string, any>[], dateStr: string): string {
    let prompt = `Generate a comprehensive daily newsletter for ${dateStr} based on the following topics. Make sure to combine topics that are related, and OUTLINE on these Topics ( News, Dev, Events, Market Conditions ). The newsletter must be a bulleted list for the popular topics with bullet points of the content under that topic. For Market Conditions BE SPECIFIC and summarize daily changes\n\n`;

    for (const [topic, items] of Object.entries(groupedContent)) {
      console.log( items.length )
      prompt += `**${topic}:**\n`;
      items.forEach((item:any) => {
        prompt += `***item***`
        if (item.text) {
          prompt += `- ${item.text}`;
        }
        if (item.link) {
          prompt += `- ${item.link}`;
        }
        if (item.metadata?.photos) {
          prompt += `- ${item.metadata?.photos}`;
        }
        if (item.metadata?.photos) {
          prompt += `- ${item.metadata?.photos}`;
        }
      });
      prompt += `***item_end***`
      prompt += `\n\n`;
    }

    prompt += `Provide a clear and concise summary that highlights the key activities and developments of the day.\n\n`;

    prompt += `Respond MUST be a JSON array containing the values in a JSON block of topics formatted for markdown with this structure:\n\`\`\`json\n\{\n  'value',\n  'value'\n\}\n\`\`\`\n\nYour response must include the JSON block. Each JSON block should include the title of the topic, and the message content. Each message content MUST be a list of json objct of "text","sources","images","videos". the sources for references (sources MUST only be under the source key, its okay if no sources under a topic), the images/videos for references (images/videos MUST only be under the source key), and the messages.`

    return prompt;
  }

  private computeCid(dateStr: string): string {
    const hash = crypto.createHash('sha256').update(dateStr).digest('hex').slice(0, 16);
    return `daily-summary-${hash}`;
  }
}