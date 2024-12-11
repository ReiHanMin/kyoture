// Import necessary modules
import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import winston from 'winston';

// Initialize Puppeteer Extra with Stealth Plugin
puppeteerExtra.use(StealthPlugin());

// Logger configuration
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
    new winston.transports.File({ filename: 'kyoto_art_center_scraper.log' }),
  ],
});

// Utility function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Utility function to generate a SHA256 hash
const generateHash = (str) => {
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Downloads an image from the given URL and saves it locally.
 * Ensures unique filenames based on URL hashes and prevents duplicates.
 * 
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'kyoto_art_center').
 * @param {string} imagesDir - The directory where images are saved.
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, imagesDir, retries = 3) => {
  try {
    if (!imageUrl || imageUrl === 'No image available') {
      logger.warn('No valid image URL provided. Using placeholder.');
      return '/images/events/placeholder.jpg'; // Ensure this placeholder exists
    }

    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://www.kac.or.jp${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

    logger.info(`Downloading image: ${absoluteImageUrl}`);

    // Parse the URL to remove query parameters for consistent hashing
    const parsedUrl = new URL(absoluteImageUrl);
    const normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`; // Excludes query params

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
      } catch (err) {
        logger.warn(`Failed to retrieve Content-Type for image: ${absoluteImageUrl}. Using default extension '.jpg'.`);
        extension = '.jpg';
      }
    }

    const filename = `${imageHash}${extension}`;
    const filepath = path.resolve(imagesDir, filename);

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
    return '/images/events/placeholder.jpg'; // Ensure this placeholder exists
  }
};

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirnameESM = path.dirname(__filename);

// Ensure screenshots directory exists
const screenshotDir = path.resolve(__dirnameESM, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  logger.info(`Created screenshots directory at ${screenshotDir}`);
} else {
  logger.info(`Screenshots directory already exists at ${screenshotDir}`);
}

// Ensure images directory exists and define the site identifier
const siteIdentifier = 'kyoto_art_center';
const imagesDir = path.resolve(__dirnameESM, '..', 'public', 'images', 'events', siteIdentifier);

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
  logger.info(`Created image directory: ${imagesDir}`);
} else {
  logger.info(`Image directory already exists: ${imagesDir}`);
}

/**
 * Function to extract event data from a single event page
 * @param {string} eventLink - The URL of the event detail page
 * @param {puppeteer.Browser} browser - The Puppeteer browser instance
 * @returns {Object|null} - The extracted event data or null if extraction fails
 */
const extractEventData = async (eventLink, browser) => {
  try {
    logger.info(`Processing event: ${eventLink}`);

    const eventPage = await browser.newPage();
    await eventPage.goto(eventLink, { waitUntil: 'networkidle0', timeout: 60000 });
    await delay(1000); // Ensure full load of page content

    // Extract data from the event page
    const title = await eventPage
      .$eval('h1.sectionTitle', (el) => el.innerText.trim())
      .catch(() => 'No title');

    const organization = await eventPage
      .$eval('.sectionTitle-line > a', (el) => el.innerText.trim())
      .catch(() => null);

    const description = await eventPage
      .$eval('.theContent', (el) => el.innerText.trim())
      .catch(() => 'No description');

    // Extract dates
    const dateInfo = await eventPage.$$eval('.sectionStatus dt', (elements) => {
      const data = {};
      elements.forEach((el) => {
        const title = el.innerText.trim();
        const value = el.nextElementSibling ? el.nextElementSibling.innerText.trim() : null;
        data[title] = value;
      });
      return data;
    });

    const dateText = dateInfo['開催日時'] || dateInfo['日時'] || null;

    let date_start = null;
    let date_end = null;

    if (dateText) {
      // Handle date ranges and single dates
      const dateRangeMatch = dateText.match(
        /(\d{4})年(\d{1,2})月(\d{1,2})日\([^\)]+\)(?:～|~)(\d{4})年(\d{1,2})月(\d{1,2})日\([^\)]+\)/
      );
      const singleDateMatch = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\([^\)]+\)/);

      if (dateRangeMatch) {
        date_start = `${dateRangeMatch[1]}-${dateRangeMatch[2].padStart(2, '0')}-${dateRangeMatch[3].padStart(2, '0')}`;
        date_end = `${dateRangeMatch[4]}-${dateRangeMatch[5].padStart(2, '0')}-${dateRangeMatch[6].padStart(2, '0')}`;
      } else if (singleDateMatch) {
        date_start = `${singleDateMatch[1]}-${singleDateMatch[2].padStart(2, '0')}-${singleDateMatch[3].padStart(2, '0')}`;
        date_end = date_start;
      } else {
        // Handle other date formats
        logger.warn(`Unrecognized date format: ${dateText}`);
      }
    }

    // Extract times
    const timeText = dateInfo['日時'] || null;

    let time_start = null;
    let time_end = null;
    if (timeText) {
      const timeMatch = timeText.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (timeMatch) {
        time_start = timeMatch[1];
        time_end = timeMatch[2];
      } else {
        // If only start time is provided
        const singleTimeMatch = timeText.match(/(\d{1,2}:\d{2})/);
        if (singleTimeMatch) {
          time_start = singleTimeMatch[1];
        }
      }
    }

    // Extract venue
    const venue = dateInfo['会場'] || null;

    // Extract prices
    const priceText = dateInfo['料金・その他'] || dateInfo['料金'] || null;

    const prices = [];
    if (priceText) {
      if (priceText.includes('無料')) {
        prices.push({
          price_tier: 'Free',
          amount: 0,
          currency: 'JPY',
          discount_info: null,
        });
      } else {
        // Extract prices
        const priceLines = priceText.split('\n').map((line) => line.trim());
        for (const line of priceLines) {
          const priceMatch = line.match(/([^\d¥￥]+)\s*[¥￥]?(\d{1,3}(?:,\d{3})*(?:\.\d+)*)/);
          if (priceMatch) {
            const priceTier = priceMatch[1].trim();
            const amount = priceMatch[2].replace(/[¥￥,]/g, '');
            prices.push({
              price_tier: priceTier,
              amount: parseInt(amount),
              currency: 'JPY',
              discount_info: null,
            });
          } else {
            // Check for lines that are just prices without tiers
            const amountMatch = line.match(/[¥￥]?(\d{1,3}(?:,\d{3})*(?:\.\d+)*)/);
            if (amountMatch) {
              const amount = amountMatch[1].replace(/[¥￥,]/g, '');
              prices.push({
                price_tier: 'General',
                amount: parseInt(amount),
                currency: 'JPY',
                discount_info: null,
              });
            }
          }
        }
      }
    }

    // Extract image URL
    const imageUrl = await eventPage
      .$eval('.normalSlide .swiper-slide-active .listItem-thumb img', (img) => img.src)
      .catch(async () => {
        // Try alternative selector
        return await eventPage
          .$eval('.normalSlide .swiper-slide .listItem-thumb img', (img) => img.src)
          .catch(() => null);
      });

    // Generate external_id
    const external_id = generateHash(`${title}-${date_start}`);

    // Prepare event data
    const eventInfo = {
      title,
      organization,
      description,
      date_start,
      date_end,
      venue,
      external_id,
      image_url: imageUrl || '/images/events/placeholder.jpg', // Placeholder if no image
      schedule: [
        {
          date: date_start,
          time_start,
          time_end,
          special_notes: null, // Add any special notes if available
          status: 'upcoming', // Will be updated based on current date
        },
      ],
      prices,
      event_link: eventLink,
      categories: [], // Populate based on available data
      tags: [], // Populate based on available data
      site: 'kyoto_art_center',
    };

    await eventPage.close();

    return eventInfo;
  } catch (error) {
    logger.error(`Error processing event at ${eventLink}: ${error.message}`);
    return null;
  }
};

/**
 * Function to extract detailed event data from the event detail page
 * @param {string} eventLink - The URL of the event detail page
 * @param {Object} eventData - The initial event data extracted from the listing page
 * @returns {Object|null} - The detailed event data or null if extraction fails
 */
const extractEventDetails = async (eventLink, eventData) => {
  try {
    logger.info(`Extracting detailed data for event: ${eventLink}`);

    const browser = await puppeteerExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const eventPage = await browser.newPage();
    await eventPage.goto(eventLink, { waitUntil: 'networkidle0', timeout: 60000 });
    await delay(1000); // Ensure full load of page content

    // Wait for main content
    await eventPage.waitForSelector('.ct-inner-960', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for .ct-inner-960 selector.');
    });

    // Extract event title (overwrite if necessary)
    const detailTitle = await eventPage
      .$eval('h1.sectionTitle', (el) => el.innerText.trim())
      .catch(() => null);
    if (detailTitle && detailTitle !== 'No title') {
      eventData.title = detailTitle;
      logger.info(`Detail page title extracted: ${detailTitle}`);
    }

    // Extract event description
    const detailDescription = await eventPage
      .$eval('.theContent', (el) => el.innerText.trim())
      .catch(() => null);
    if (detailDescription && detailDescription !== 'No description') {
      eventData.description = detailDescription;
      logger.info(`Detail page description extracted.`);
    }

    // Extract image URL and download
    let imageUrl = eventData.image_url;
    if (imageUrl && imageUrl !== 'No image available') {
      imageUrl = await downloadImage(imageUrl, siteIdentifier, imagesDir);
      eventData.image_url = imageUrl;
      logger.info(`Image downloaded and updated: ${imageUrl}`);
    } else {
      eventData.image_url = '/images/events/placeholder.jpg';
      logger.warn(`No valid image URL for event "${eventData.title}". Assigned placeholder.`);
    }

    // Assign status based on current date
    const today = new Date();
    const eventDate = new Date(eventData.date_start);
    eventData.status = eventDate >= today ? 'upcoming' : 'ended';

    await eventPage.close();
    await browser.close();

    return eventData;
  } catch (error) {
    logger.error(`Error extracting event details for ${eventLink}: ${error.message}`);
    return eventData; // Return what we have so far
  }
};

/**
 * Main scraping function
 */
const scrapeKyotoArtCenterMain = async () => {
  // Launch Puppeteer with necessary options
  const browser = await puppeteerExtra.launch({
    headless: true, // Set to false for debugging
    slowMo: 0, // Adjust as needed
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  logger.info('Browser launched.');
  const page = await browser.newPage();
  logger.info('New page opened.');

  try {
    const baseUrl = 'https://www.kac.or.jp';
    let eventsUrl = `${baseUrl}/events/month/`;

    const eventData = [];

    while (true) {
      logger.info(`Navigating to Kyoto Art Center events page: ${eventsUrl}`);
      await page.goto(eventsUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      logger.info('Page loaded.');

      // Wait for the events list to load
      const eventsExist = await page.$('ul.eventsList.listType-thumb');
      if (!eventsExist) {
        logger.info('No events found on this page.');
        break;
      }

      await page.waitForSelector('ul.eventsList.listType-thumb', { timeout: 30000 }).catch(() => {
        logger.warn('Timeout waiting for ul.eventsList.listType-thumb selector.');
      });

      // Extract event links
      const eventLinks = await page.$$eval('ul.eventsList.listType-thumb li.listItem > a', (links) =>
        links.map((a) => a.href)
      );

      logger.info(`Found ${eventLinks.length} event links on page: ${eventsUrl}`);

      for (const eventLink of eventLinks) {
        const eventInfo = await extractEventData(eventLink, browser);
        if (eventInfo) {
          // Extract detailed event data
          const detailedEventInfo = await extractEventDetails(eventInfo.event_link, eventInfo);
          if (detailedEventInfo) {
            eventData.push(detailedEventInfo);
            logger.info(`Extracted event: ${detailedEventInfo.title}`);
          }
        }
      }

      // Check for the "next month" link
      const nextMonthLink = await page.$eval('ul.monthChanger li.monthChanger-next a', (a) => a.href).catch(() => null);

      if (nextMonthLink) {
        // Navigate to the next month
        eventsUrl = nextMonthLink;
        logger.info(`Found next month link: ${eventsUrl}`);
        await delay(1000); // Small delay before navigating to the next month
      } else {
        logger.info('No next month link found. Scraping complete.');
        break;
      }
    }

    await browser.close();
    logger.info('Browser closed.');

    // Return the collected event data
    return eventData;
  } catch (error) {
    logger.error(`Error during scraping: ${error.message}`);
    await browser.close();
    logger.info('Browser closed due to error.');
    return [];
  }
};

/**
 * Execute the scraper if the script is run directly
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running Kyoto Art Center scraper...');
      const data = await scrapeKyotoArtCenterMain();
      if (data.length > 0) {
        logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
        const outputPath = path.resolve(__dirnameESM, 'kyoto_art_center_events.json');
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        logger.info(`Data saved to ${outputPath}`);
      } else {
        logger.warn('No data scraped for site: kyoto_art_center');
      }
      logger.info('All scraping tasks completed.');
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}

export default scrapeKyotoArtCenterMain;
