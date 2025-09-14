import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { ContentItem, MediaDownloadItem } from "../types";
import { logger } from "./cliHelper";
import { extractAttachmentMedia, extractEmbedMedia, extractStickerMedia } from "./mediaHelper";
import { safeJsonParse, isValidArray } from "./generalHelper";

/**
 * file utility functions for the AI News Aggregator.
 * This module provides file helper functions used across the application.
 * 
 * @module helpers
 */

export const isMediaFile = (url: string, contentType?: string | null): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const videoExtensions = ['.mp4', '.webm', '.mov'];
    const mediaExtensions = [...imageExtensions, ...videoExtensions];

    // Check content type if available
    if (contentType) {
      return contentType.startsWith('image/') || contentType.startsWith('video/');
    }

    // Check file extension
    return mediaExtensions.some(ext => url.toLowerCase().endsWith(ext));
}

/**
   * Writes summary content to a file in the specified format.
   * @param outputPath - File string to write the file to
   * @param dateStr - Date string for the file name
   * @param content - Content to write
   * @param format - File format ('json' or 'md')
   * @returns Promise<void>
   */
export const writeFile = async (outputPath: string, dateStr: string, content: any, format: 'json' | 'md'): Promise<void> => {
    try {
      const dir = path.join(outputPath, format);
      ensureDirectoryExists(dir);
      
      const filePath = path.join(dir, `${dateStr}.${format}`);
      
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`Error saving Discord summary to ${format} file ${dateStr}:`, error);
    }
}

/**
 * Validates that a file path is safe to use (prevents path traversal attacks)
 * @param filePath - File path to validate
 * @returns True if path is safe, false otherwise
 */
export const isValidPath = (filePath: string): boolean => {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  
  // Check for path traversal attempts
  const dangerous = ['../', '..\\', '~/', '/etc/', '/root/', '/home/'];
  if (dangerous.some(pattern => filePath.includes(pattern))) {
    return false;
  }
  
  // Ensure path is relative and not absolute
  if (path.isAbsolute(filePath)) {
    return false;
  }
  
  return true;
};

/**
 * Sanitizes a filename by removing dangerous characters
 * @param filename - Original filename
 * @returns Sanitized filename
 */
export const sanitizeFilename = (filename: string): string => {
  if (!filename || typeof filename !== 'string') {
    return 'unknown';
  }
  
  // Remove dangerous characters and replace with underscores
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_') // Remove leading dots
    .substring(0, 255); // Limit length
};

/**
 * Validates that a URL is safe to download from
 * @param url - URL to validate
 * @returns True if URL is safe, false otherwise
 */
export const isValidUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    
    // Only allow HTTPS and HTTP
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    
    // Block localhost and private IP ranges
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return false;
    }
    
    // Block private IP ranges (basic check)
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
};

/**
 * Ensures the output directory exists safely.
 * @param dirPath - Directory path to check/create
 */
export const ensureDirectoryExists = (dirPath: string) => {
    // Validate path before creating
    if (!isValidPath(dirPath)) {
      throw new Error(`Invalid directory path: ${dirPath}`);
    }
    
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Determines the file type directory based on content type and filename
 * @param contentType - MIME content type
 * @param filename - Original filename
 * @returns Directory name ('images', 'videos', 'audio', or 'documents')
 */
export const getFileTypeDir = (contentType: string, filename: string): string => {
  if (contentType) {
    if (contentType.startsWith('image/')) return 'images';
    if (contentType.startsWith('video/')) return 'videos';  
    if (contentType.startsWith('audio/')) return 'audio';
  }
  
  // Fallback to extension
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images';
  if (['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'].includes(ext)) return 'videos';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
  
  return 'documents';
}

/**
 * Generates a SHA-256 hash of file content
 * @param data - File data buffer
 * @returns SHA-256 hash as hex string
 */
export const generateContentHash = (data: Buffer): string => {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generates a SHA-256 hash of a URL
 * @param url - URL to hash
 * @returns SHA-256 hash as hex string
 */
export const generateUrlHash = (url: string): string => {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * Extracts filename from a URL
 * @param url - URL to extract filename from
 * @returns Extracted filename with fallback to 'unknown.jpg'
 */
export const extractFilenameFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || 'unknown';
    return filename.includes('.') ? filename : `${filename}.jpg`;
  } catch {
    return 'unknown.jpg';
  }
}

/**
 * Extracts media items from Discord raw data
 * @param item - ContentItem containing Discord raw data
 * @returns Array of MediaDownloadItem objects
 */
export const extractDiscordMediaData = (item: ContentItem): MediaDownloadItem[] => {
  const mediaItems: MediaDownloadItem[] = [];
  
  if (item.type !== 'discordRawData' || !item.text) {
    return mediaItems;
  }

  try {
    const data = safeJsonParse(item.text, {} as any);
    
    if (data.messages && isValidArray(data.messages)) {
      for (const message of data.messages) {
        const channelName = data.channel?.name || 'unknown';
        const guildName = data.guild?.name || 'unknown';

        // Process attachments using shared utility
        if (message.attachments && isValidArray(message.attachments)) {
          for (const attachment of message.attachments) {
            const mediaItem = extractAttachmentMedia(
              attachment,
              message.id,
              message.ts,
              channelName,
              guildName
            );
            if (mediaItem) {
              mediaItems.push(mediaItem);
            }
          }
        }

        // Process embeds using shared utility
        if (message.embeds && isValidArray(message.embeds)) {
          for (const embed of message.embeds) {
            const embedMedia = extractEmbedMedia(
              embed,
              message.id,
              message.ts,
              channelName,
              guildName
            );
            mediaItems.push(...embedMedia);
          }
        }

        // Process stickers using shared utility
        if (message.sticker_items && isValidArray(message.sticker_items)) {
          for (const sticker of message.sticker_items) {
            const mediaItem = extractStickerMedia(
              sticker,
              message.id,
              message.ts,
              channelName,
              guildName
            );
            if (mediaItem) {
              mediaItems.push(mediaItem);
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to parse Discord data: ${error}`);
  }

  return mediaItems;
}
