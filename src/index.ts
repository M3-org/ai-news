import { ContentAggregator } from "./aggregator/ContentAggregator";
import { loadDirectoryModules, loadItems, loadProviders, loadStorage, } from "./helpers/configHelper";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

(async () => {
  try {
    // Fetch overide args to get run specific source config
    const args = process.argv.slice(2);
    let sourceFile = "sources.json"
    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      }
    });

    const sourceClasses = await loadDirectoryModules("sources");
    const aiClasses = await loadDirectoryModules("ai");
    const enricherClasses = await loadDirectoryModules("enrichers");
    const generatorClasses = await loadDirectoryModules("generators");
    const storageClasses = await loadDirectoryModules("storage");
    
    // Load the JSON configuration file
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);
    
    let runOnce = configJSON?.settings?.runOnce || false;
    
    let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
    let sourceConfigs = await loadItems(configJSON.sources, sourceClasses, "source");
    let enricherConfigs = await loadItems(configJSON.enrichers, enricherClasses, "enrichers");
    let generatorConfigs = await loadItems(configJSON.generators, generatorClasses, "generators");
    let storageConfigs = await loadItems(configJSON.storage, storageClasses, "storage");

    // If any configs depends on the AI provider, set it here
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
    generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);

    // If any configs depends on the storage, set it here
    generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
  
    const aggregator = new ContentAggregator();
  
    // Register Sources under Aggregator
    sourceConfigs.forEach((config) => aggregator.registerSource(config.instance));

    // Register Enrichers under Aggregator
    enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
  
    // Initialize and Register Storage, Should just be one Storage Plugin for now.
    storageConfigs.forEach(async (storage : any) => {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    });

    //Fetch Sources
    for ( const config of sourceConfigs ) {
      await aggregator.fetchAndStore(config.instance.name);

      setInterval(() => {
        aggregator.fetchAndStore(config.instance.name);
      }, config.interval);
    };
    
    //Generate Content
    for ( const generator of generatorConfigs ) {
      generator.instance.generateContent();

      setInterval(() => {
        generator.instance.generateContent();
      }, generator.interval);
    };

    console.log("Content aggregator is running and scheduled.");
    
    const shutdown = async () => {
      console.log("Shutting down...");
      storageConfigs.forEach(async (storage : any) => {
        await storage.close();
      });
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    if (runOnce) {
      await shutdown();
      console.log("Content aggregator is complete.");
    }
  } catch (error) {
    console.error("Error initializing the content aggregator:", error);
    process.exit(1);
  }
})();
