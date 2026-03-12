/**
 * Historical data collection and processing entry point.
 * This script allows fetching historical data from sources and generating summaries
 * for specific dates or date ranges.
 * 
 * @module historical
 */

import { HistoricalAggregator } from "./aggregator/HistoricalAggregator";
import { MediaDownloader, generateManifestToFile } from "./download-media";
import { MediaDownloadCapable } from "./plugins/sources/DiscordRawDataSource";
import { SummaryEnricher } from "./plugins/enrichers/SummaryEnricher";
import { logger } from "./helpers/cliHelper";
import { ProgressDashboard, setActiveProgressDashboard } from "./helpers/progressDashboard";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import {
  loadDirectoryModules,
  loadItems,
  loadProviders,
  loadStorage,
  validateConfiguration
} from "./helpers/configHelper";
import { callbackDateRangeLogic, collectDateRange } from "./helpers/dateHelper";

dotenv.config({ quiet: true });

/**
 * Type guard to check if a source supports media downloading
 */
function hasMediaDownloadCapability(source: any): source is MediaDownloadCapable & { name: string } {
  return source && typeof source.hasMediaDownloadEnabled === 'function';
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function describeMode(onlyFetch: boolean, onlyGenerate: boolean): string {
  if (onlyGenerate) return "generate-only";
  if (onlyFetch) return "fetch-only";
  return "fetch+generate";
}

function describeDateScope(fetchDates: string[]): string {
  if (fetchDates.length === 0) return "none";
  if (fetchDates.length === 1) return fetchDates[0];
  return `${fetchDates[fetchDates.length - 1]} -> ${fetchDates[0]}`;
}

function buildFetchHeaderLines(options: {
  sourceFile: string;
  mode: string;
  fetchDates: string[];
  outputPath: string;
  currentSource?: string;
  currentDate?: string;
  overrideCount: number;
}): string[] {
  const lines = [
    `Config: ${options.sourceFile} | Mode: ${options.mode} | Dates: ${describeDateScope(options.fetchDates)}`,
    `Output: ${options.outputPath} | Channel override: ${options.overrideCount > 0 ? `${options.overrideCount} channel(s)` : 'none'}`,
  ];

  if (options.currentSource || options.currentDate) {
    lines.push(`Current: ${options.currentSource || '-'} @ ${options.currentDate || '-'}`);
  }

  return lines;
}

function buildFetchSummary(options: {
  sourceFile: string;
  fetchDates: string[];
  totalJobs: number;
  completedJobs: number;
  startedAt: number;
  stats: Record<string, string>;
}): string[] {
  const summary = [
    "Historical fetch summary",
    `  config: ${options.sourceFile}`,
    `  dates: ${describeDateScope(options.fetchDates)}`,
    `  source-date jobs: ${options.completedJobs}/${options.totalJobs}`,
    `  elapsed: ${formatDuration(Date.now() - options.startedAt)}`,
  ];

  const statLabels: Array<[string, string]> = [
    ["queued", "queued channels"],
    ["active", "active channels"],
    ["done", "completed channels"],
    ["failed", "failed channels"],
    ["skip_existing", "skipped existing"],
    ["skip_unavailable", "skipped unavailable"],
    ["skip_future", "skipped future"],
    ["items", "stored items"],
  ];

  for (const [key, label] of statLabels) {
    if (options.stats[key] !== undefined) {
      summary.push(`  ${label}: ${options.stats[key]}`);
    }
  }

  return summary;
}

(async () => {
  try {
    /**
     * Parse command line arguments for historical data collection
     * --source: JSON configuration file path
     * --date: Specific date to fetch data for
     * --before: End date for range fetching
     * --after: Start date for range fetching
     * --during: Date to fetch data during
     * --onlyFetch: Only fetch data without generating summaries
     * --download-media: Enable media downloads after data collection
     * --output/-o: Output directory path
     */
    const args = process.argv.slice(2);
    const today = new Date();
    let sourceFile = "sources.json";
    let dateStr = today.toISOString().slice(0, 10);
    let onlyFetch = false;
    let onlyGenerate = false;
    let skipExisting = false;
    let force = false;
    let downloadMedia = false;
    let generateManifest = false;
    let manifestOutput: string | undefined;
    let mediaManifestPath: string | undefined;
    let beforeDate;
    let afterDate;
    let duringDate;
    let outputPath = './'; // Default output path
    let overrideChannels: string[] = [];

    if (args.includes('--help') || args.includes('-h')) {
      logger.info(`
Historical Data Fetcher & Summarizer

Usage:
  npm run historical -- --source=<config_file.json> [options]
  ts-node src/historical.ts --source=<config_file.json> [options]

Options:
  --source=<file>       JSON configuration file path (default: sources.json)
  --date=<YYYY-MM-DD>   Specific date to process.
  --before=<YYYY-MM-DD> End date for a range.
  --after=<YYYY-MM-DD>  Start date for a range.
  --during=<YYYY-MM-DD> Alias for --date.
  --only-fetch          Only fetch data, do not generate summaries.
  --only-generate       Only generate summaries from existing data, do not fetch.
  --onlyFetch           Legacy alias for --only-fetch.
  --onlyGenerate        Legacy alias for --only-generate.
  --download-media      Download Discord media after data collection (default: false).
  --generate-manifest   Generate media manifest JSON for VPS downloads (default: false).
  --manifest-output=<path> Output path for manifest file (default: <output>/media-manifest.json).
  --media-manifest=<path> Path to media manifest for CDN URL enrichment in summaries.
  --channels=<id1,id2>  Comma-separated channel IDs to override config (archive mode).
  --output=<path>       Output directory path (default: ./)
  -h, --help            Show this help message.
      `);
      process.exit(0);
    }
    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      } else if (arg.startsWith('--date=')) {
        dateStr = arg.split('=')[1];
      } else if (
        arg === '--onlyGenerate' ||
        arg === '--onlyGenerate=true' ||
        arg === '--only-generate' ||
        arg === '--only-generate=true'
      ) {
        onlyGenerate = true;
      } else if (arg === '--onlyGenerate=false' || arg === '--only-generate=false') {
        onlyGenerate = false;
      } else if (
        arg === '--onlyFetch' ||
        arg === '--onlyFetch=true' ||
        arg === '--only-fetch' ||
        arg === '--only-fetch=true'
      ) {
        onlyFetch = true;
      } else if (arg === '--onlyFetch=false' || arg === '--only-fetch=false') {
        onlyFetch = false;
      } else if (arg === '--download-media' || arg === '--download-media=true') {
        downloadMedia = true;
      } else if (arg === '--download-media=false') {
        downloadMedia = false;
      } else if (arg === '--generate-manifest' || arg === '--generate-manifest=true') {
        generateManifest = true;
      } else if (arg === '--generate-manifest=false') {
        generateManifest = false;
      } else if (arg.startsWith('--manifest-output=')) {
        manifestOutput = arg.split('=')[1];
      } else if (arg.startsWith('--before=')) {
        beforeDate = arg.split('=')[1];
      } else if (arg.startsWith('--after=')) {
        afterDate = arg.split('=')[1];
      } else if (arg.startsWith('--during=')) {
        duringDate = arg.split('=')[1];
      } else if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
        outputPath = arg.split('=')[1];
      } else if (arg.startsWith('--channels=')) {
        overrideChannels = arg.split('=')[1].split(',').map(id => id.trim()).filter(Boolean);
      } else if (arg === '--skip-existing' || arg === '--skip-existing=true') {
        skipExisting = true;
      } else if (arg === '-f' || arg === '--force') {
        force = true;
      }
    });

    /**
     * Load all plugin modules from their respective directories
     * This includes sources, AI providers, enrichers, generators, and storage plugins
     */
    const sourceClasses = await loadDirectoryModules("sources");
    const aiClasses = await loadDirectoryModules("ai");
    const enricherClasses = await loadDirectoryModules("enrichers");
    const generatorClasses = await loadDirectoryModules("generators");
    const storageClasses = await loadDirectoryModules("storage");
    
    /**
     * Load and parse the JSON configuration file
     * This contains settings for all plugins and their parameters
     */
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);

    /**
     * Apply configuration overrides from the JSON file
     * These settings control the behavior of the historical aggregator
     */
    if (typeof configJSON?.settings?.onlyFetch === 'boolean') {
      onlyFetch = configJSON?.settings?.onlyFetch || onlyFetch;
    }
    if (typeof configJSON?.settings?.onlyGenerate === 'boolean') {
      onlyGenerate = configJSON?.settings?.onlyGenerate || onlyGenerate;
    }
    
    /**
     * Initialize all plugin configurations
     * This creates instances of each plugin with their respective parameters
     */
    let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
    let sourceConfigs = await loadItems(configJSON.sources, sourceClasses, "source");
    let enricherConfigs = await loadItems(configJSON.enrichers, enricherClasses, "enrichers");
    let generatorConfigs = await loadItems(configJSON.generators, generatorClasses, "generators");
    let storageConfigs = await loadItems(configJSON.storage, storageClasses, "storage");

    /**
     * Set up dependencies between plugins
     * AI providers are injected into sources, enrichers, and generators
     * Storage is injected into generators, sources
     */
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    sourceConfigs = await loadStorage(sourceConfigs, storageConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
    generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
    generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
    
    /**
     * Override channelIds for all Discord sources if --channels flag is provided (archive mode)
     */
    if (overrideChannels.length > 0) {
      logger.info(`Archive mode: overriding channels to [${overrideChannels.join(', ')}]`);
      sourceConfigs.forEach(config => {
        if (config.instance && Array.isArray((config.instance as any).channelIds)) {
          (config.instance as any).channelIds = overrideChannels;
        }
      });
    }

    /**
     * Override media download settings if --download-media flag is provided
     */
    if (downloadMedia) {
      sourceConfigs.forEach(config => {
        if (config.instance && config.instance.mediaDownload !== undefined) {
          logger.info(`Enabling media download for source: ${config.instance.name} (overriding config)`);
          config.instance.mediaDownload.enabled = true;
        }
      });
    }
    
    /**
     * Call the validation function
     */
    validateConfiguration({ 
        sources: sourceConfigs,
        ai: aiConfigs,
        enrichers: enricherConfigs,
        generators: generatorConfigs,
        storage: storageConfigs
    });

    /**
     * Configure output paths for all generators
     * This ensures summaries are saved to the specified location
     */
    generatorConfigs.forEach(config => {
      if (config.instance && typeof config.instance.outputPath === 'undefined') {
        config.instance.outputPath = outputPath;
      }
    });

    /**
     * Initialize the historical aggregator and register all plugins
     * This sets up the historical data collection and processing pipeline
     */
    const aggregator = new HistoricalAggregator();
  
    /**
     * Register sources that support historical data fetching
     * Only sources with fetchHistorical method are registered
     */
    sourceConfigs.forEach((config) => {
      if (config.instance?.fetchHistorical) {
        aggregator.registerSource(config.instance);
      }
    });

    /**
     * Register storage plugins with aggregator
     * Note: Enrichers are NOT registered here - they run after generators produce summaries
     */
    storageConfigs.forEach(async (storage : any) => {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    });

    /**
     * Set up date filtering based on command line arguments
     * This determines whether to fetch data for a specific date or date range
     */
    let filter: any = {};
    if (beforeDate || afterDate || duringDate) {
      if (beforeDate && afterDate) {
        filter = { after: afterDate, before: beforeDate };
      } else if (duringDate) {
        filter = { filterType: 'during', date: duringDate };
      } else if (beforeDate) {
        filter = { filterType: 'before', date: beforeDate };
      } else if (afterDate) {
        filter = { filterType: 'after', date: afterDate };
      }
    }
      
    /**
     * Pre-connect sources that support it (e.g. Discord) so they log in once
     * rather than reconnecting on every date iteration in a range fetch.
     */
    for (const config of sourceConfigs) {
      if (typeof (config.instance as any).connect === 'function') {
        await (config.instance as any).connect();
      }
    }

    // Preload existing CID map for range fetches — replaces per-date DB queries with O(1) lookups
    if (!onlyGenerate && filter.after && filter.before) {
      for (const config of sourceConfigs) {
        if (typeof (config.instance as any).preloadExistingRange === 'function') {
          logger.info(`Preloading existing data range for ${config.instance.name}...`);
          await (config.instance as any).preloadExistingRange(filter.after, filter.before);
        }
      }
    }

    /**
     * Fetch historical data based on the date filter
     * If a date range is specified, fetch data for the entire range
     * Otherwise, fetch data for the specific date
     */
    if (!onlyGenerate) {
      const fetchDates = filter.filterType || (filter.after && filter.before)
        ? await collectDateRange(filter)
        : [dateStr];
      const totalFetchJobs = sourceConfigs.length * fetchDates.length;
      const fetchStartedAt = Date.now();
      let completedFetchJobs = 0;
      const fetchDashboard = new ProgressDashboard({
        title: "Historical Fetch Dashboard",
      });

      setActiveProgressDashboard(fetchDashboard);
      fetchDashboard.setHeaderLines(buildFetchHeaderLines({
        sourceFile,
        mode: describeMode(onlyFetch, onlyGenerate),
        fetchDates,
        outputPath,
        overrideCount: overrideChannels.length,
      }));
      fetchDashboard.setOverall({
        label: "source-date jobs",
        current: 0,
        total: totalFetchJobs,
        detail: totalFetchJobs > 0 ? "waiting to start" : "no fetch jobs",
      });
      fetchDashboard.setStats({
        sources: sourceConfigs.length,
        dates: fetchDates.length,
        queued: 0,
        active: 0,
        done: 0,
        failed: 0,
        skip_existing: 0,
        skip_unavailable: 0,
        skip_future: 0,
        items: 0,
      });

      try {
        for (const config of sourceConfigs) {
          for (const fetchDate of fetchDates) {
            fetchDashboard.clearTasks();
            fetchDashboard.setHeaderLines(buildFetchHeaderLines({
              sourceFile,
              mode: describeMode(onlyFetch, onlyGenerate),
              fetchDates,
              outputPath,
              currentSource: config.instance.name,
              currentDate: fetchDate,
              overrideCount: overrideChannels.length,
            }));
            fetchDashboard.setOverall({
              label: "source-date jobs",
              current: completedFetchJobs,
              total: totalFetchJobs,
              detail: `${config.instance.name} @ ${fetchDate}`,
            });

            await aggregator.fetchAndStore(config.instance.name, fetchDate);
            completedFetchJobs += 1;

            fetchDashboard.setOverall({
              label: "source-date jobs",
              current: completedFetchJobs,
              total: totalFetchJobs,
              detail: completedFetchJobs < totalFetchJobs
                ? `${config.instance.name} @ ${fetchDate}`
                : "fetch stage complete",
            });
          }
        }
        logger.info("Content aggregator is finished fetching historical.");
      } finally {
        setActiveProgressDashboard(null);
        fetchDashboard.finish(buildFetchSummary({
          sourceFile,
          fetchDates,
          totalJobs: totalFetchJobs,
          completedJobs: completedFetchJobs,
          startedAt: fetchStartedAt,
          stats: fetchDashboard.getStatsSnapshot(),
        }));
      }
    }
    
    /**
     * Download media files if --download-media flag is enabled
     * This runs after historical data fetching but before summary generation
     */
    if (downloadMedia && !onlyGenerate) {
      logger.info("Starting media downloads...");
      logger.info(`Found ${sourceConfigs.length} source configs to check`);
      
      // Find sources with media download capability
      const mediaCapableSources = sourceConfigs.filter(config => 
        hasMediaDownloadCapability(config.instance) && config.instance.hasMediaDownloadEnabled()
      );
      
      if (mediaCapableSources.length === 0) {
        logger.warning("No sources with media download enabled found.");
      } else {
        for (const sourceConfig of mediaCapableSources) {
          logger.debug(`Checking source: ${sourceConfig.instance.name}`);
          logger.info(`✓ Source ${sourceConfig.instance.name} supports media downloads`);
          const mediaConfig = sourceConfig.instance.mediaDownload;
          logger.debug(`Media config: ${JSON.stringify(mediaConfig)}`);
          if (mediaConfig?.enabled) {
            logger.info(`Downloading media for ${sourceConfig.instance.name}...`);
            
            try {
              const storage = (sourceConfig.instance as any).storage;
              const dbPath = storage.dbPath || './data/db.sqlite';
              const outputPath = mediaConfig.outputPath || './media';
              
              const downloader = new MediaDownloader(dbPath, outputPath, mediaConfig);
              await downloader.init();
              
              let stats;
              if (filter.filterType || (filter.after && filter.before)) {
                // Date range download
                const startDate = new Date(filter.after || filter.date);
                const endDate = new Date(filter.before || filter.date);
                stats = await downloader.downloadMediaInDateRange(startDate, endDate);
              } else {
                // Single date download
                stats = await downloader.downloadMediaForDate(new Date(filter.date));
              }
              
              downloader.printStats();
              await downloader.close();
              logger.info(`✅ Media download completed for source: ${sourceConfig.instance.name}`);
              
            } catch (error) {
              logger.error(`❌ Media download failed for source ${sourceConfig.instance.name}: ${error}`);
            }
          }
        }
      }
    }

    /**
     * Generate media manifest if requested
     * Creates a JSON file listing all media URLs for VPS download
     */
    if (generateManifest && !onlyGenerate) {
      logger.info("Generating media manifest...");

      for (const config of sourceConfigs) {
        if (hasMediaDownloadCapability(config.instance)) {
          try {
            const storage = (config.instance as any).storage;
            const dbPath = storage?.dbPath || './data/db.sqlite';

            // Determine source name from config
            const sourceName = sourceFile.replace('.json', '').replace('-discord', '');

            // Determine manifest output path
            const manifestPath = manifestOutput || path.join(outputPath, sourceName, 'media-manifest.json');

            // Generate manifest for date or date range
            if (filter.filterType || (filter.after && filter.before)) {
              // Date range - generate combined manifest
              const startDate = filter.after || filter.date;
              const endDate = filter.before || filter.date;
              logger.info(`Generating manifest for date range: ${startDate} to ${endDate}`);
              await generateManifestToFile(dbPath, startDate, sourceName, manifestPath, endDate);
            } else {
              // Single date
              logger.info(`Generating manifest for date: ${dateStr}`);
              await generateManifestToFile(dbPath, dateStr, sourceName, manifestPath);
            }

            logger.success(`Media manifest generated: ${manifestPath}`);
          } catch (error) {
            logger.error(`Manifest generation failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          break; // Only generate one manifest per run
        }
      }
    }

    /**
     * Generate summaries if not in fetch-only mode
     * For date ranges, generate summaries for each date in the range
     * For specific dates, generate a summary for that date
     */
    if (!onlyFetch) {
      if (filter.filterType || (filter.after && filter.before)) {
        for (const generator of generatorConfigs) {
          await generator.instance.storage.init();
          await callbackDateRangeLogic(filter, async (dateStr: string) => {
            if (skipExisting && !force) {
              const epochTs = new Date(dateStr).getTime() / 1000;
              const summaryType = (generator.instance as any).summaryType;
              if (summaryType) {
                const storage = generator.instance.storage as any;
                if (typeof storage.getContentItemsBetweenEpoch === "function") {
                  const existing = await storage.getContentItemsBetweenEpoch(
                    epochTs, epochTs + 86400, summaryType
                  );
                  if (existing && existing.length > 0) {
                    logger.info(`Skipping ${dateStr} — summary already exists (use --force to regenerate)`);
                    return;
                  }
                } else {
                  logger.warning(`Storage for ${generator.instance.constructor.name} does not support skip-existing summary checks; generating ${dateStr}`);
                }
              }
            }
            await generator.instance.generateAndStoreSummary(dateStr);
          });
        }
      } else {
        logger.info(`Creating summary for date ${dateStr}`);
        for (const generator of generatorConfigs) {
          await generator.instance.storage.init();
          await generator.instance.generateAndStoreSummary(dateStr);
        }
      }

      /**
       * Enrich summaries with memes and posters AFTER generation
       * This runs enrichers on the AI-generated summaries, not raw data
       */
      if (enricherConfigs.length > 0) {
        logger.info("Enriching generated summaries with memes and posters...");
        const summaryEnricher = new SummaryEnricher({
          enrichers: enricherConfigs.map(c => c.instance),
          outputPath: outputPath,
        });

        // Determine JSON subpath from generator config (typically "elizaos/json")
        const jsonSubpath = generatorConfigs.length > 0
          ? path.join(generatorConfigs[0].instance.source || "elizaos", "json")
          : "elizaos/json";

        if (filter.filterType || (filter.after && filter.before)) {
          await callbackDateRangeLogic(filter, (dateStr: string) =>
            summaryEnricher.enrichSummary(dateStr, jsonSubpath)
          );
        } else {
          await summaryEnricher.enrichSummary(dateStr, jsonSubpath);
        }
      }
    }
    else {
      logger.info("Historical Data successfully saved. Summary wasn't generated");
    }

    /**
     * Clean up resources and exit
     * This ensures all storage connections are properly closed
     */
    logger.info("Shutting down...");
    storageConfigs.forEach(async (storage : any) => {
      await storage.close();
    });
    process.exit(0);
  } catch (error) {
    logger.error(`Error initializing the content aggregator: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
})();
