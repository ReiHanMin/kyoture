// kakubarhythm.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';
import crypto from 'crypto';
// If you intend to use p-limit for concurrency, ensure it's installed and uncomment the line below
// import pLimit from 'p-limit';

// Load environment variables from .env file if present
dotenv.config();

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configure logger using winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'kakubarhythm_scraper.log' }),
  ],
});

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to validate time format
const isValidTime = (timeStr) => {
  return /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.test(timeStr);
};

// Define __filename and __dirname for ES modules
const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

/**
 * Utility function to generate a SHA256 hash of a given string.
 * @param {string} str - The input string to hash.
 * @returns {string} - The resulting SHA256 hash in hexadecimal format.
 */
const generateHash = (str) => {
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Downloads an image from the given URL and saves it locally.
 * Ensures that images are saved with unique filenames based on their URL hashes.
 * Prevents duplicate downloads by checking existing files.
 * 
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'kakubarhythm').
 * @param {string} imagesDir - The directory where images are saved.
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, imagesDir, retries = 3) => {
  try {
    if (!imageUrl || imageUrl === 'No image available') {
      logger.warn('No valid image URL provided. Using placeholder.');
      return '/images/events/kakubarhythm/placeholder.jpg'; // Ensure this placeholder exists
    }

    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://kakubarhythm.com${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

    logger.info(`Downloading image: ${absoluteImageUrl}`);

    // Parse the URL to remove query parameters for consistent hashing
    const parsedUrl = new URL(absoluteImageUrl);
    const normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`; // Excludes query params

    // Generate a unique filename using SHA256 hash of the normalized image URL
    const imageHash = generateHash(normalizedUrl);
    let extension = path.extname(parsedUrl.pathname) || '.jpg'; // Handle URLs without extensions

    // If extension is not valid, attempt to get it from Content-Type
    if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(extension.toLowerCase())) {
      const headResponse = await axios.head(absoluteImageUrl);
      const contentType = headResponse.headers['content-type'];
      if (contentType) {
        const matches = /image\/(jpeg|png|gif|bmp|webp)/.exec(contentType);
        if (matches && matches[1]) {
          extension = `.${matches[1]}`;
        } else {
          extension = '.jpg'; // Default extension
        }
      } else {
        extension = '.jpg'; // Default extension
      }
    }

    const filename = `${imageHash}${extension}`;
    const filepath = path.join(imagesDir, filename);

    // Check if the image file already exists
    if (fs.existsSync(filepath)) {
      logger.info(`Image already exists locally: ${filename}`);
      return `/images/events/${site}/${filename}`;
    }

    // Download the image
    const response = await axios.get(absoluteImageUrl, { responseType: 'stream', timeout: 30000 }); // 30 seconds timeout

    const writer = fs.createWriteStream(filepath);

    response.data.pipe(writer);

    // Wait for the download to finish
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', (err) => {
        logger.error(`Error writing image to ${filepath}: ${err.message}`);
        reject(err);
      });
    });

    logger.info(`Image downloaded and saved to: ${filepath}`);

    // Return the relative URL to the image
    return `/images/events/${site}/${filename}`;
  } catch (error) {
    if (retries > 0) {
      logger.warn(`Retrying download for image: ${imageUrl}. Attempts left: ${retries}`);
      await delay(1000); // Wait before retrying
      return downloadImage(imageUrl, site, imagesDir, retries - 1);
    }
    logger.error(`Failed to download image after retries: ${imageUrl}. Error: ${error.message}`);
    // Return path to a placeholder image
    return '/images/events/kakubarhythm/placeholder.jpg'; // Ensure this placeholder exists
  }
};

// Main scraping function for Kakubarhythm Kyoto Events
const scrapeKakubarhythm = async () => {
  // Define the site identifier for image storage
  const siteIdentifier = 'kakubarhythm';

  // Define the directory where images will be saved
  // Navigate one level up from 'node_scripts' to 'kyoture'
  const imagesDir = resolve(__dirnameESM, '..', 'public', 'images', 'events', siteIdentifier);

  // Create the directory if it doesn't exist
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    logger.info(`Created directory: ${imagesDir}`);
  } else {
    logger.info(`Directory already exists: ${imagesDir}`);
  }

  // Launch Puppeteer with necessary options
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 0,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  logger.info('Browser launched.');
  const page = await browser.newPage();
  logger.info('New page opened.');

  try {
    logger.info('Navigating to Kakubarhythm live events page...');
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    const scrapeUrl = process.env.SCRAPE_URL || 'https://kakubarhythm.com/live';
    await page.goto(scrapeUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    logger.info('Page loaded.');

    // Wait for articles to load
    await page.waitForSelector('article', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for article selectors.');
    });

    const eventElements = await page.$$('article');
    logger.info(`Found ${eventElements.length} event items.`);
    const eventData = [];

    // Define an array of possible price tier keywords
    const priceTierKeywords = [
      'スタンディング',
      '指定席',
      '前売り',
      '当日券',
      '学生券',
      'その他',
      '一般チケット',
      '学割チケット',
      '一般',
      '学割',
      '前売',
      'STANDING',
      '学割STANDING',
      '指定席',
    ];

    // Create a regex pattern dynamically based on the price tier keywords
    const priceTierPattern = priceTierKeywords.join('|');
    const priceRegex = new RegExp(`^(${priceTierPattern})\\s*[:：]?\\s*[¥￥]?([\\d,]+)`, 'i');

    // If using p-limit for concurrency, set it up here
    // const limit = pLimit(5); // Limit to 5 concurrent downloads

    for (const [index, eventElement] of eventElements.entries()) {
      try {
        logger.info(`Processing event ${index + 1} of ${eventElements.length}...`);

        // Extract data from the main page
        const dateText = await eventElement
          .$eval('td.live-top-date', (el) => el.innerText.trim())
          .catch(() => null);
        const eventTitle = await eventElement
          .$eval('td.live-top-event', (el) => el.innerText.trim())
          .catch(() => 'Unnamed Event');
        const venue = await eventElement
          .$eval('td.live-top-place', (el) => el.innerText.trim())
          .catch(() => 'Unknown Venue');
        const eventLink = await eventElement
          .$eval('a.overimg', (el) => el.href)
          .catch(() => null);

        logger.info(`Event Title: ${eventTitle}`);
        logger.info(`Venue: ${venue}`);
        logger.info(`Extracted event link: ${eventLink}`);

        // **Filtering: Only proceed if venue starts with '京都'**
        if (!venue.startsWith('京都')) {
          logger.info(`Skipping event at venue: ${venue}`);
          continue; // Skip to the next event
        }

        // Parse date
        const dateMatch = dateText ? dateText.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/) : null;
        const date_start = dateMatch
          ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
          : null;
        const date_end = date_start; // Assuming single-day events for simplicity

        if (eventLink && date_start) {
          logger.info(`Navigating to event detail page: ${eventLink}`);
          const detailPage = await browser.newPage();
          await detailPage.setUserAgent(
            process.env.USER_AGENT ||
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
          );
          await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await delay(2000); // Ensure full load of page content

          // Extract description
          const description = await detailPage
            .$eval('.entry-content', (el) => el.innerText.trim())
            .catch(() => 'No description available');

          // Extract time information
          const timeText = await detailPage
            .$eval('h3.fwb.fco + p', (el) => el.innerText.trim())
            .catch(() => null);

          // Extract ticket information
          const ticketInfo = await detailPage.evaluate(() => {
            const ticketHeader = [...document.querySelectorAll('h3')].find((el) =>
              el.textContent.includes('TICKET')
            );
            return ticketHeader
              ? ticketHeader.nextElementSibling
                ? ticketHeader.nextElementSibling.innerText.trim()
                : 'No ticket information'
              : 'No ticket information';
          });

          logger.info(`Ticket info: ${ticketInfo}`);

          // Initialize prices and free status
          let isFree = false;
          const prices = [];

          if (ticketInfo !== 'No ticket information') {
            if (ticketInfo.includes('無料') || ticketInfo.includes('参加費無料')) {
              isFree = true;
            } else if (ticketInfo.includes('詳細は後日発表') || ticketInfo.includes('Comingsoon')) {
              isFree = null;
            } else {
              const priceLines = ticketInfo
                .split(/<br\s*\/?>|\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

              priceLines.forEach((line) => {
                if (/https?:\/\//.test(line) || line.startsWith('※') || line.includes('詳細は後日発表') || line.includes('Comingsoon')) {
                  return;
                }

                const match = line.match(priceRegex);
                if (match) {
                  const priceTier = match[1];
                  const amount = match[2].replace(/,/g, '');
                  prices.push({
                    price_tier: priceTier,
                    amount: amount,
                    currency: 'JPY',
                    discount_info: null,
                  });
                }
              });

              const additionalPriceRegex = new RegExp(`^(${priceTierPattern})\\s*チケット\\s*[¥￥]?([\\d,]+)`, 'i');
              priceLines.forEach((line) => {
                if (/https?:\/\//.test(line) || line.startsWith('※') || line.includes('詳細は後日発表') || line.includes('Comingsoon')) {
                  return;
                }

                const match = line.match(additionalPriceRegex);
                if (match) {
                  const priceTier = match[1] + 'チケット';
                  const amount = match[2].replace(/,/g, '');
                  prices.push({
                    price_tier: priceTier,
                    amount: amount,
                    currency: 'JPY',
                    discount_info: null,
                  });
                }
              });
            }
          }

          let freeStatus = false;
          if (isFree === true) {
            freeStatus = true;
          } else if (isFree === null) {
            freeStatus = false;
            logger.warn(`Free status indeterminate for event: ${eventTitle}`);
          }

          const imageUrl = await detailPage
            .$eval('.entry-content img', (img) => img.src)
            .catch(() => null);

          const validImageUrl = imageUrl && imageUrl.startsWith('http')
            ? imageUrl
            : process.env.DEFAULT_IMAGE_URL || 'https://kakubarhythm.com/wordpress/wp-content/uploads/2024/10/mainvisual_pc_20241031.jpg';

          let time_start = null;
          let time_end = null;
          if (timeText) {
            if (timeText.includes('/')) {
              const times = timeText.split('/').map((time) => time.trim());
              if (isValidTime(times[0])) {
                time_start = times[0] + (times[0].includes(':') ? '' : ':00');
              } else {
                logger.warn(`Invalid start time format: ${times[0]} for event: ${eventTitle}`);
                time_start = null;
              }
              if (times[1] && isValidTime(times[1])) {
                time_end = times[1] + (times[1].includes(':') ? '' : ':00');
              } else {
                logger.warn(`Invalid end time format: ${times[1]} for event: ${eventTitle}`);
                time_end = null;
              }
            } else {
              if (isValidTime(timeText)) {
                time_start = timeText + (timeText.includes(':') ? '' : ':00');
              } else {
                logger.warn(`Invalid time format: ${timeText} for event: ${eventTitle}`);
                time_start = null;
              }
            }
          }

          // Download the image and get the local URL
          const localImageUrl = validImageUrl && validImageUrl !== 'No image available'
            ? await downloadImage(validImageUrl, siteIdentifier, imagesDir)
            : '/images/events/kakubarhythm/placeholder.jpg'; // Ensure this placeholder exists

          const eventInfo = {
            title: eventTitle,
            date_start,
            date_end,
            time_start,
            time_end,
            venue,
            organization: 'Kakubarhythm',
            image_url: localImageUrl,
            schedule: [
              {
                date: date_start,
                time_start,
                time_end,
                special_notes: null,
              },
            ],
            prices: prices.length > 0 ? prices : [],
            description,
            event_link: eventLink,
            raw_price_text: ticketInfo,
            categories: [],
            tags: [],
            ended: false,
            free: freeStatus,
            site: 'kakubarhythm',
          };

          if (ticketInfo.includes('詳細は後日発表')) {
            eventInfo.description += ' 詳細は後日発表されます。';
          }

          eventInfo.categories = eventInfo.categories.length > 0 ? eventInfo.categories : ['Live Event'];
          eventInfo.tags = eventInfo.tags.length > 0 ? eventInfo.tags : ['Music', 'Concert'];

          if (!eventInfo.title || !eventInfo.date_start || !eventInfo.venue) {
            logger.warn(`Essential information missing for event: ${eventTitle}. Skipping event.`);
            await detailPage.close();
            continue;
          }

          eventData.push(eventInfo);
          logger.info(`Extracted structured event data: ${JSON.stringify(eventInfo)}`);
          await detailPage.close();
        }
      } catch (error) {
        logger.error(`Error processing event ${index + 1}: ${error.message}`);
      }
    }

    logger.info('Final event data extraction complete.');
    await browser.close();
    logger.info('Browser closed.');
    return eventData.map((event) => ({ ...event, site: 'kakubarhythm' }));
  } catch (error) {
    logger.error(`Error during scraping: ${error.message}`);
    await browser.close();
    logger.info('Browser closed due to error.');
    return [];
  }
};

// Export the scraping function
export default scrapeKakubarhythm;

// If the script is run directly, execute the scraping function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running Kakubarhythm scraper...');
      const data = await scrapeKakubarhythm();
      logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
      const outputPath = resolve(__dirnameESM, 'kakubarhythm_events.json');
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`Data saved to ${outputPath}`);
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}
