// fabcafe.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';
import crypto from 'crypto';
import axios from 'axios';
import pLimit from 'p-limit'; // Ensure p-limit is installed

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
    new winston.transports.File({ filename: 'fabcafe_kyoto_scraper.log' }),
  ],
});

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to validate time format (HH:mm)
const isValidTime = (timeStr) => {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr);
};

// Function to generate a unique external ID using SHA256 hash
const generateExternalId = (title, date_start) => {
  const hash = crypto.createHash('sha256');
  hash.update(title + date_start);
  return hash.digest('hex');
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
 * @param {string} site - The site identifier (e.g., 'fabcafe').
 * @param {string} imagesDir - The directory where images are saved.
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, imagesDir, retries = 3) => {
  try {
    if (!imageUrl || imageUrl === 'No image available') {
      logger.warn('No valid image URL provided. Using placeholder.');
      // Assign a unique placeholder based on the event's imageUrl
      const placeholderFilename = `placeholder_${generateHash(imageUrl || 'default')}.jpg`;
      const placeholderPath = `/images/events/${site}/${placeholderFilename}`;
      const fullPlaceholderPath = resolve(imagesDir, placeholderFilename);

      // Check if the unique placeholder already exists
      if (!fs.existsSync(fullPlaceholderPath)) {
        // Copy a default placeholder image if it exists
        const defaultPlaceholder = resolve(imagesDir, 'placeholder.jpg');
        if (fs.existsSync(defaultPlaceholder)) {
          fs.copyFileSync(defaultPlaceholder, fullPlaceholderPath);
          logger.info(`Copied unique placeholder for image: ${placeholderFilename}`);
        } else {
          logger.error(`Default placeholder not found at ${defaultPlaceholder}. Please ensure it exists.`);
          return '/images/events/fabcafe/default_placeholder.jpg'; // Fallback to a general placeholder
        }
      }

      return placeholderPath;
    }

    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://fabcafe.com${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

    logger.info(`Downloading image: ${absoluteImageUrl}`);

    // Parse the URL to remove query parameters for consistent hashing
    const parsedUrl = new URL(absoluteImageUrl);
    const normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`; // Includes query params

    // Generate a unique filename using SHA256 hash of the normalized image URL
    const imageHash = generateHash(normalizedUrl);
    let extension = path.extname(parsedUrl.pathname) || '.jpg'; // Handle URLs without extensions

    // If extension is not valid, attempt to get it from Content-Type
    if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(extension.toLowerCase())) {
      try {
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
      } catch (headError) {
        logger.warn(`Failed to fetch HEAD for image: ${absoluteImageUrl}. Using default extension.`);
        extension = '.jpg';
      }
    }

    const filename = `${imageHash}${extension}`;
    const filepath = resolve(imagesDir, filename);

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
    // Assign a unique placeholder for failed downloads
    const uniquePlaceholder = `/images/events/${site}/placeholder_${generateHash(imageUrl)}.jpg`;
    const fullPlaceholderPath = resolve(imagesDir, path.basename(uniquePlaceholder));

    if (!fs.existsSync(fullPlaceholderPath)) {
      // Copy a default placeholder image if it exists
      const defaultPlaceholder = resolve(imagesDir, 'placeholder.jpg');
      if (fs.existsSync(defaultPlaceholder)) {
        fs.copyFileSync(defaultPlaceholder, fullPlaceholderPath);
        logger.info(`Assigned unique placeholder for failed image: ${uniquePlaceholder}`);
      } else {
        logger.error(`Default placeholder not found at ${defaultPlaceholder}. Please ensure it exists.`);
        return '/images/events/fabcafe/default_placeholder.jpg'; // Fallback to a general placeholder
      }
    }

    return uniquePlaceholder;
  }
};

// Ensure screenshots directory exists
const screenshotDir = resolve(__dirnameESM, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  logger.info(`Created screenshots directory at ${screenshotDir}`);
} else {
  logger.info(`Screenshots directory already exists at ${screenshotDir}`);
}

// Define concurrency limit for image downloads
const limit = pLimit(5); // Adjust based on system capabilities

// Main scraping function for FabCafe Kyoto Events
const scrapeFabCafe = async () => {
  // Define the site identifier for image storage
  const siteIdentifier = 'fabcafe';

  // Define the directory where images will be saved
  // Navigate one level up from 'node_scripts' to 'kyoture'
  const imagesDir = resolve(__dirnameESM, '..', 'public', 'images', 'events', siteIdentifier);

  // Create the directory if it doesn't exist
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    logger.info(`Created image directory: ${imagesDir}`);
  } else {
    logger.info(`Image directory already exists: ${imagesDir}`);
  }

  // Launch Puppeteer with necessary options
  const browser = await puppeteer.launch({
    headless: true, // Set to false for debugging
    slowMo: 0, // Adjust as needed
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  logger.info('Browser launched.');
  const page = await browser.newPage();
  logger.info('New page opened.');

  try {
    logger.info('Navigating to FabCafe Kyoto events page...');
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    const scrapeUrl = process.env.SCRAPE_URL || 'https://fabcafe.com/jp/events/kyoto/';
    await page.goto(scrapeUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    logger.info('Page loaded.');

    // Capture a screenshot to verify loaded content
    await page.screenshot({ path: 'fabcafe_listing_page.png', fullPage: true });
    logger.info('Screenshot of the listing page saved as fabcafe_listing_page.png');

    // Wait for the main events container to load
    await page.waitForSelector('.event-slide-col1-list', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for .event-slide-col1-list selector.');
    });

    // **Adjusted Event Selection Selector**
    const eventElements = await page.$$(
      'div.event-slide-col1-list a.block.hv-scale'
    );

    logger.info(`Found ${eventElements.length} events on the listing page.`);

    // Optional: Log titles of found events for verification
    for (const [index, eventElement] of eventElements.entries()) {
      const eventTitle = await eventElement.$eval('div.top-info > .ttl', el => el.innerText.trim()).catch(() => 'No Title');
      logger.info(`Event ${index + 1} Title: ${eventTitle}`);
    }

    const eventsData = [];

    for (const [index, eventElement] of eventElements.entries()) {
      try {
        logger.info(`Processing event ${index + 1} of ${eventElements.length}...`);

        // Extract the event URL from the <a> tag
        const eventUrl = await eventElement.evaluate(el => el.href.trim()).catch(() => null);

        if (!eventUrl) {
          logger.warn(`Missing event URL for event ${index + 1}. Skipping.`);
          continue;
        }

        // Extract event title
        const eventTitle = await eventElement.$eval('div.top-info > .ttl', (el) =>
          el.innerText.trim()
        ).catch(() => null);

        if (!eventTitle) {
          const outerHTML = await eventElement.evaluate((el) => el.outerHTML);
          logger.warn(
            `Missing event title for event ${index + 1}. Skipping. Event URL: ${eventUrl}. Outer HTML: ${outerHTML}`
          );
          continue;
        } else {
          logger.info(`Event title extracted: ${eventTitle}`);
        }

        // Extract event description
        const eventDescription = await eventElement.$eval('div.top-info > p.text', (el) =>
          el.innerText.trim()
        ).catch(() => null);

        // Extract image URL from listing page
        let imageUrl = await eventElement.$eval(
          'div.img-box > div.img > div.posi-full.bg-style',
          (el) => el.getAttribute('data-bg')
        ).catch(() => null);

        logger.info(`Event ${index + 1} Listing Image URL: ${imageUrl}`);

        if (imageUrl && !imageUrl.startsWith('http')) {
          // Handle relative URLs
          imageUrl = new URL(imageUrl, scrapeUrl).href;
        }

        // Extract labels/tags
        const tags = await eventElement.$$eval(
          'ul.label-elm-list01 > li > span',
          (elements) => elements.map((el) => el.innerText.trim())
        ).catch(() => []);

        // Extract dates
        const dateElements = await eventElement.$$('div.ct-day-box > div.ct-day-circle-label');
        let dates = [];
        for (const dateElement of dateElements) {
          const monthText = await dateElement
            .$eval('p.ct-day-circle-month', (el) => el.innerText.trim())
            .catch(() => null);
          const dayText = await dateElement
            .$eval('p.ct-day-circle-day', (el) => el.innerText.trim())
            .catch(() => null);

          if (monthText && dayText) {
            // Convert month from abbreviated form to number
            const month = convertMonthToNumber(monthText);
            const day = dayText.padStart(2, '0');
            const currentYear = new Date().getFullYear();
            const date = `${currentYear}-${month}-${day}`;
            dates.push(date);
          }
        }

        // Set date_start and date_end
        let date_start = dates.length > 0 ? dates[0] : null;
        let date_end = dates.length > 1 ? dates[dates.length - 1] : date_start;

        // Generate external_id
        const external_id = generateExternalId(eventTitle, date_start);

        // Create event object with data from listing page
        const eventData = {
          title: eventTitle,
          description: eventDescription || null,
          date_start: date_start,
          date_end: date_end,
          external_id: external_id,
          image_url: imageUrl || process.env.DEFAULT_IMAGE_URL || '',
          tags: tags,
          event_link: eventUrl,
          site: 'fabcafe',
        };

        // Navigate to the event detail page to extract more data
        const eventPage = await browser.newPage();
        await eventPage.goto(eventUrl, { waitUntil: 'networkidle0', timeout: 60000 });

        // Extract more details from the event page
        const detailedEventData = await extractEventDetails(eventPage, eventData, imagesDir, siteIdentifier);

        await eventPage.close();

        // Validate essential fields
        if (!detailedEventData.title || !detailedEventData.date_start) {
          logger.warn(
            `Essential information missing for event ${index + 1}. Skipping. Event URL: ${eventUrl}`
          );
          continue;
        }

        eventsData.push(detailedEventData);
        logger.info(`Extracted event: ${detailedEventData.title}`);
      } catch (error) {
        logger.error(`Error processing event ${index + 1}: ${error.message}`);
        logger.error(`Stack Trace: ${error.stack}`);
      }
    }

    logger.info('Final event data extraction complete.');
    await browser.close();
    logger.info('Browser closed.');
    return eventsData;
  } catch (error) {
    logger.error(`Error during scraping: ${error.message}`);
    await browser.close();
    logger.info('Browser closed due to error.');
    return [];
  }
};

/**
 * Function to extract detailed event data from the event detail page
 * @param {puppeteer.Page} eventPage - The Puppeteer page instance for the event detail
 * @param {Object} eventData - The initial event data extracted from the listing page
 * @param {string} imagesDir - Directory to save images
 * @param {string} siteIdentifier - Identifier for the site (e.g., 'fabcafe')
 * @returns {Object} - The detailed event data
 */
const extractEventDetails = async (eventPage, eventData, imagesDir, siteIdentifier) => {
  try {
    // Wait for the main content to load
    await eventPage.waitForSelector('.ct-inner-960', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for .ct-inner-960 selector.');
    });

    // Extract event title (overwrite if necessary)
    const detailTitle = await eventPage.$eval(
      'h1.event-single-post-ttl',
      (el) => el.innerText.trim()
    ).catch(() => null);
    if (detailTitle) {
      eventData.title = detailTitle;
      logger.info(`Detail page title extracted: ${detailTitle}`);
    }

    // Extract event description
    const detailDescription = await eventPage.$$eval('div.right-box.bs-b.wysiwyg p', (elements) =>
      elements.map((el) => el.innerText.trim()).join('\n\n')
    ).catch(() => null);
    if (detailDescription) {
      eventData.description = detailDescription;
      logger.info(`Detail page description extracted.`);
    }

    // Extract event dates and times
    const dateText = await eventPage.$eval('p.date', (el) => el.innerText.trim()).catch(() => null);
    if (dateText) {
      const dateMatch = dateText.match(
        /(\d{4})\.(\d{1,2})\.(\d{1,2})\s*\(.+\)\s*–\s*(\d{4})\.(\d{1,2})\.(\d{1,2})\s*\(.+\)/
      );
      if (dateMatch) {
        eventData.date_start = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
        eventData.date_end = `${dateMatch[4]}-${dateMatch[5].padStart(2, '0')}-${dateMatch[6].padStart(2, '0')}`;
        logger.info(`Detail page dates extracted: ${eventData.date_start} to ${eventData.date_end}`);
      } else {
        // Single day event
        const singleDateMatch = dateText.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
        if (singleDateMatch) {
          eventData.date_start = `${singleDateMatch[1]}-${singleDateMatch[2].padStart(2, '0')}-${singleDateMatch[3].padStart(2, '0')}`;
          eventData.date_end = eventData.date_start;
          logger.info(`Detail page single date extracted: ${eventData.date_start}`);
        }
      }
    }

    // Extract time information
    const timeText = await eventPage.$eval(
      'p.event-single-info-elm.time',
      (el) => el.innerText.trim()
    ).catch(() => null);
    if (timeText) {
      const timeMatch = timeText.match(/(\d{1,2}:\d{2})\s*–\s*(\d{1,2}:\d{2})/);
      if (timeMatch) {
        eventData.time_start = timeMatch[1];
        eventData.time_end = timeMatch[2];
        logger.info(`Detail page times extracted: ${eventData.time_start} to ${eventData.time_end}`);
      } else {
        // Handle cases like "11:00 – 19:00 水曜日・土曜日開催"
        const timeOnlyMatch = timeText.match(/(\d{1,2}:\d{2})\s*–\s*(\d{1,2}:\d{2})/);
        if (timeOnlyMatch) {
          eventData.time_start = timeOnlyMatch[1];
          eventData.time_end = timeOnlyMatch[2];
          logger.info(`Detail page times extracted: ${eventData.time_start} to ${eventData.time_end}`);
        }
      }
    }

    // Extract venue information
    const venueText = await eventPage.$$eval(
      'p.event-single-info-elm.place',
      (elements) => elements.map((el) => el.innerText.trim())
    ).catch(() => []);

    let venueName = null;
    let address = null;

    for (const text of venueText) {
      if (text.includes('Google mapで開く')) {
        // Venue name and address
        const venueMatch = text.match(/(.+?)\s*｜\s*Google mapで開く/);
        if (venueMatch) {
          venueName = venueMatch[1].trim();
        }
        // Extract Google Maps link for address
        const googleMapsLink = await eventPage.$eval(
          'p.event-single-info-elm.place a[href*="google.com/maps"]',
          (el) => el.href
        ).catch(() => null);
        if (googleMapsLink) {
          // Optionally, you can use Google Maps API to get the address details
          address = null; // Not implemented here
        }
      }
    }

    eventData.venue = {
      name: venueName || 'FabCafe Kyoto',
      address: address || null,
      city: 'Kyoto',
      postal_code: null,
      country: 'Japan',
    };

    // Extract price information
    const priceText = venueText.find((text) => text.includes('円'));
    const prices = [];
    if (priceText) {
      // Example: "4,000円 / 1名"
      const priceMatch = priceText.match(/([￥¥]?[\d,]+円)(?:\s*\/\s*(\d+名))?/);
      if (priceMatch) {
        const amountStr = priceMatch[1].replace(/[￥¥,円]/g, '');
        const amount = parseFloat(amountStr);
        const price_tier = 'General';
        prices.push({
          price_tier,
          amount: isNaN(amount) ? null : amount,
          currency: 'JPY',
          discount_info: null,
        });
        logger.info(`Detail page price extracted: ${price_tier} - ${amount} ${prices[0].currency}`);
      }
    }

    eventData.prices = prices.length > 0 ? prices : null;

    // Determine if the event is free
    eventData.free = prices.length === 0;

    // Create schedules
    eventData.schedules = [
      {
        date: eventData.date_start || null,
        time_start: isValidTime(eventData.time_start) ? eventData.time_start : null,
        time_end: isValidTime(eventData.time_end) ? eventData.time_end : null,
        special_notes: null, // Add any special notes if available
        status: 'upcoming', // Determine based on current date
      },
    ];

    // Extract alt text for image
    let alt_text = await eventPage.$eval('div.img-box > div.img > div.posi-full.bg-style', (el) =>
      el.getAttribute('data-alt')
    ).catch(() => null);

    eventData.alt_text = alt_text || null;

    // **Updated Image Extraction Logic for Detail Pages**
    const detailImageUrl = await eventPage.$eval(
      'p.event-single-main-img > img',
      (el) => el.getAttribute('src') || el.getAttribute('data-src')
    ).catch(() => null);

    logger.info(`Detail Page Image URL for Event "${eventData.title}": ${detailImageUrl}`);

    if (detailImageUrl) {
      // Download the detailed image
      const detailedImageUrl = detailImageUrl.startsWith('http')
        ? detailImageUrl
        : new URL(detailImageUrl, eventData.event_link).href;

      const localImageUrl = await limit(() => downloadImage(detailedImageUrl, siteIdentifier, imagesDir));
      eventData.image_url = localImageUrl;
      logger.info(`Detail Page Local Image URL for Event "${eventData.title}": ${localImageUrl}`);
    } else if (eventData.image_url) {
      // Download the image from the listing page
      const localImageUrl = await limit(() => downloadImage(eventData.image_url, siteIdentifier, imagesDir));
      eventData.image_url = localImageUrl;
      logger.info(`Listing Page Local Image URL for Event "${eventData.title}": ${localImageUrl}`);
    } else {
      // Assign unique placeholder if no image is available
      const uniquePlaceholder = `/images/events/${siteIdentifier}/placeholder_${generateHash(eventData.title)}.jpg`;
      const fullPlaceholderPath = resolve(imagesDir, path.basename(uniquePlaceholder));

      if (!fs.existsSync(fullPlaceholderPath)) {
        // Copy a default placeholder image if it exists
        const defaultPlaceholder = resolve(imagesDir, 'placeholder.jpg');
        if (fs.existsSync(defaultPlaceholder)) {
          fs.copyFileSync(defaultPlaceholder, fullPlaceholderPath);
          logger.info(`Assigned unique placeholder for Event "${eventData.title}": ${uniquePlaceholder}`);
        } else {
          logger.error(`Default placeholder not found at ${defaultPlaceholder}. Please ensure it exists.`);
          eventData.image_url = '/images/events/fabcafe/default_placeholder.jpg'; // Fallback to a general placeholder
        }
      } else {
        eventData.image_url = uniquePlaceholder;
        logger.info(`Assigned existing unique placeholder for Event "${eventData.title}": ${uniquePlaceholder}`);
      }
    }

    return eventData;
  } catch (error) {
    logger.error(`Error extracting event details: ${error.message}`);
    return eventData; // Return what we have so far
  }
};

/**
 * Helper function to convert abbreviated month to number
 * @param {string} monthAbbreviation - Abbreviated month name (e.g., 'Jan', 'Feb')
 * @returns {string} - Two-digit month number (e.g., '01', '02')
 */
const convertMonthToNumber = (monthAbbreviation) => {
  const months = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
    'Jan.': '01',
    'Feb.': '02',
    'Mar.': '03',
    'Apr.': '04',
    'May.': '05',
    'Jun.': '06',
    'Jul.': '07',
    'Aug.': '08',
    'Sep.': '09',
    'Oct.': '10',
    'Nov.': '11',
    'Dec.': '12',
  };
  return months[monthAbbreviation] || '01';
};

// Execute the scraper if the script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running FabCafe Kyoto scraper...');
      const data = await scrapeFabCafe();
      if (data.length > 0) {
        logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
        const outputPath = resolve(__dirnameESM, 'fabcafe_kyoto_events.json');
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        logger.info(`Data saved to ${outputPath}`);
      } else {
        logger.warn('No data scraped for site: fabcafe');
      }
      logger.info('All scraping tasks completed.');
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}

export default scrapeFabCafe;
