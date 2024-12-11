// scrape_all.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import path from 'path'; // **Added Import**
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';
import crypto from 'crypto';
import axios from 'axios';
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
    new winston.transports.File({ filename: 'growly_scraper.log' }),
  ],
});

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to validate time format
const isValidTime = (timeStr) => {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr);
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
 * @param {string} site - The site identifier (e.g., 'growly').
 * @param {string} imagesDir - The directory where images are saved.
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, imagesDir, retries = 3) => {
  try {
    if (!imageUrl || imageUrl === 'No image available') {
      logger.warn('No valid image URL provided. Using placeholder.');
      return '/images/events/growly/placeholder.jpg'; // Ensure this placeholder exists
    }

    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://growly.net${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

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
    // Return path to a placeholder image
    return '/images/events/growly/placeholder.jpg'; // Ensure this placeholder exists
  }
};

// Helper function to resolve URLs with enhanced logging
const resolveUrl = (base, relative) => {
  try {
    let resolvedUrl = '';
    if (relative.startsWith('./')) {
      relative = relative.slice(2);
      resolvedUrl = `https://growly.net/schedule/${relative}`;
      logger.info(`Resolved internal relative URL './${relative}' to '${resolvedUrl}'`);
    } else if (relative.startsWith('/')) {
      resolvedUrl = `https://growly.net${relative}`;
      logger.info(`Resolved absolute path URL '${relative}' to '${resolvedUrl}'`);
    } else if (relative.startsWith('http')) {
      resolvedUrl = relative;
      logger.info(`URL is already absolute: '${resolvedUrl}'`);
    } else {
      resolvedUrl = new URL(relative, base).href;
      logger.info(`Resolved other relative URL '${relative}' to '${resolvedUrl}'`);
    }
    return resolvedUrl;
  } catch (error) {
    logger.error(`Failed to resolve URL. Base: ${base}, Relative: ${relative}. Error: ${error.message}`);
    return null;
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

// Main scraping function for Growly Events
const scrapeGrowly = async () => {
  // Define the site identifier for image storage
  const siteIdentifier = 'growly';

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
    // Function to scrape a single month
    const scrapeMonth = async (year, month) => {
      logger.info(`Scraping events for ${year}-${month.toString().padStart(2, '0')}...`);
      const scrapeUrl = `https://growly.net/schedule/?year=${year}&month=${month.toString().padStart(2, '0')}`;
      await page.goto(scrapeUrl, {
        waitUntil: 'networkidle0',
        timeout: 60000,
      });
      logger.info(`Navigated to ${scrapeUrl}`);

      // Wait for the schedule table to load
      const scheduleTableSelector = '#js_schedule_table';
      const tableExists = await page.$(scheduleTableSelector);
      if (!tableExists) {
        logger.info(`No schedule table found for ${year}-${month.toString().padStart(2, '0')}. Assuming no events.`);
        return null; // No events found for this month
      }

      // Check if the table has any event rows
      const eventRows = await page.$$('#js_schedule_table > tbody > tr');
      if (eventRows.length === 0) {
        logger.info(`No event rows found for ${year}-${month.toString().padStart(2, '0')}.`);
        return null; // No events found for this month
      }

      logger.info(`Found ${eventRows.length} date rows for ${year}-${month.toString().padStart(2, '0')}.`);
      const monthEventData = [];

      // Determine the base URL dynamically from the current page with trailing slash
      const currentPageUrl = page.url();
      const baseUrlObj = new URL(currentPageUrl);
      baseUrlObj.pathname = baseUrlObj.pathname.endsWith('/') ? baseUrlObj.pathname : `${baseUrlObj.pathname}/`;
      const baseUrl = baseUrlObj.href;
      logger.info(`Determined base URL for resolving relative links: ${baseUrl}`);

      for (const [dateIndex, dateRow] of eventRows.entries()) {
        try {
          // Extract the date and day of week
          const dateText = await dateRow.$eval('th p.s_calendar_list_day', (el) => el.innerText.trim()).catch(() => null);
          const dayOfWeek = await dateRow.$eval('th p:nth-child(2)', (el) => el.innerText.trim()).catch(() => null);

          if (!dateText) {
            logger.warn(`Date text not found for date row ${dateIndex + 1} in ${year}-${month.toString().padStart(2, '0')}. Skipping.`);
            continue;
          }

          const date_start = `${year}-${month.toString().padStart(2, '0')}-${dateText.padStart(2, '0')}`;
          const date_end = date_start; // Assuming single-day events

          // Select the corresponding events table
          const eventsTable = await dateRow.$('td > table > tbody');

          if (!eventsTable) {
            logger.warn(`Events table not found for date ${date_start}. Skipping.`);
            continue;
          }

          // Select all Event Rows under this date
          const eventRowsInner = await eventsTable.$$('tr.normal');
          logger.info(`Processing ${eventRowsInner.length} events for date ${date_start}.`);

          for (const [eventIndex, eventRow] of eventRowsInner.entries()) {
            try {
              logger.info(`Processing event ${eventIndex + 1} of ${eventRowsInner.length} on ${date_start}...`);

              // Extract basic event data from the event row
              const title = await eventRow.$eval('td.schedule_name h3 a', (el) => el.innerText.trim()).catch(() => 'Unnamed Event');
              let eventLinkRelative = await eventRow.$eval('td.schedule_name h3 a', (el) => el.getAttribute('href')).catch(() => null);

              if (!eventLinkRelative) {
                logger.warn(`No link found for event "${title}" on ${date_start}. Skipping.`);
                continue;
              }

              // Resolve the event link to absolute URL using the updated resolveUrl function
              const detailUrl = resolveUrl(baseUrl, eventLinkRelative);

              if (!detailUrl) {
                logger.warn(`Could not resolve URL for event "${title}" on ${date_start}. Skipping.`);
                continue;
              }

              // **Filter to process only internal detail links**
              if (!detailUrl.startsWith('https://growly.net/schedule/detail.html?id=')) {
                logger.info(`External or unexpected link detected for event "${title}": ${detailUrl}. Skipping.`);
                continue;
              }

              logger.info(`Resolved detail URL for event "${title}": ${detailUrl}`);

              // Generate a unique external_id based on the detailUrl's id parameter
              const urlObjDetail = new URL(detailUrl);
              const external_id = urlObjDetail.searchParams.get('id') || `growly_${date_start}_${eventIndex + 1}`;

              // Navigate to the event detail page to extract additional information and image_url
              let description = '';
              let organization = 'Growly'; // Default organization
              let venueDetails = {
                name: 'GROWLY',
                address: '京都市内', // Update with actual address if available
                city: '京都',
                postal_code: null,
                country: 'Japan',
              };
              let imageUrlDetail = null;
              let time_start = null;
              let time_end = null;

              try {
                const detailPage = await browser.newPage();
                logger.info(`Opened new page for detail page: ${external_id}`);

                await detailPage.setUserAgent(
                  process.env.USER_AGENT ||
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
                );

                await detailPage.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                logger.info(`Navigated to event detail page: ${detailUrl}`);

                // Take a screenshot for debugging
                await detailPage.screenshot({ path: resolve(screenshotDir, `${external_id}.png`), fullPage: true });
                logger.info(`Screenshot taken for event "${title}" at screenshots/${external_id}.png`);

                // Wait for image selector
                await detailPage.waitForSelector('p.schedule_d_img img', { timeout: 30000 }).catch(() => {
                  logger.warn(`Image selector not found for event "${title}".`);
                });

                // Extract description using CSS selectors via page.evaluate
                const descriptionExtracted = await detailPage.evaluate(() => {
                  const thElements = Array.from(document.querySelectorAll("tr > th"));
                  const targetTh = thElements.find(th => th.textContent.includes('ARTIST') || th.textContent.includes('ARTISTS'));
                  if (targetTh) {
                    const td = targetTh.nextElementSibling;
                    return td ? td.innerText.trim().replace(/^出演:\s*/, '') : null;
                  }
                  return null;
                }).catch(() => null);

                if (descriptionExtracted) {
                  description = descriptionExtracted;
                  logger.info(`Extracted description (artist) for event "${title}": ${description}`);
                } else {
                  description = 'No description available';
                  logger.warn(`No artist information found for event "${title}". Using default description.`);
                }

                // Extract time_start and time_end using CSS selectors via page.evaluate
                const timeText = await detailPage.evaluate(() => {
                  const thElements = Array.from(document.querySelectorAll("tr > th"));
                  const targetTh = thElements.find(th => th.textContent.includes('OPEN') || th.textContent.includes('OPEN / START'));
                  return targetTh ? (targetTh.nextElementSibling?.innerText.trim() || null) : null;
                }).catch(() => null);

                if (timeText) {
                  // Clean and split the time text
                  const cleanedTimeText = timeText.replace(/\u00A0/g, ' ').replace(/&nbsp;/g, ' ').trim();
                  const times = cleanedTimeText.split('/').map((t) => t.trim());
                  if (times.length >= 2) {
                    const [start, end] = times;
                    if (isValidTime(start)) {
                      time_start = start;
                    } else {
                      logger.warn(`Invalid start time format: ${start} for event: ${title}`);
                      time_start = null;
                    }
                    if (times[1] && isValidTime(times[1])) {
                      time_end = times[1];
                    } else {
                      logger.warn(`Invalid end time format: ${times[1]} for event: ${title}`);
                      time_end = null;
                    }
                  } else if (times.length === 1) {
                    const [start] = times;
                    if (isValidTime(start)) {
                      time_start = start;
                    } else {
                      logger.warn(`Invalid time format: ${start} for event: ${title}`);
                      time_start = null;
                    }
                  } else {
                    logger.warn(`Unexpected time format for event "${title}": ${timeText}`);
                  }
                } else {
                  logger.warn(`No time information found for event "${title}".`);
                }

                // Extract high-resolution image using CSS selectors via page.evaluate
                imageUrlDetail = await detailPage.evaluate(() => {
                  const img = document.querySelector('p.schedule_d_img img');
                  return img ? img.src : null;
                }).catch(() => null);

                if (imageUrlDetail) {
                  imageUrlDetail = imageUrlDetail.startsWith('http') ? imageUrlDetail : new URL(imageUrlDetail, baseUrl).href;
                  logger.info(`Extracted detail page image URL for event "${title}": ${imageUrlDetail}`);
                } else {
                  imageUrlDetail = null;
                  logger.warn(`No detail page image found for event "${title}". Using default image.`);
                }

                await detailPage.close();
                logger.info(`Closed detail page for event "${title}".`);
              } catch (detailError) {
                logger.error(`Error accessing detail page for event "${title}" on ${date_start}: ${detailError.message}`);
                // Continue without additional details
              }

              // Decide which image URL to use: detail page image takes precedence
              const finalImageUrl = imageUrlDetail || (process.env.DEFAULT_IMAGE_URL || 'https://growly.net/images/default_event.jpg');
              logger.info(`Final image URL for event "${title}": ${finalImageUrl}`);

              // Extract price information
              const priceInfo = await eventRow
                .$eval('td.schedule_event_price table.s_time_price', (table) => {
                  const adv = table.querySelector('tr:nth-child(2) td')?.innerText.trim() || null;
                  const door = table.querySelector('tr:nth-child(3) td')?.innerText.trim() || null;
                  return { adv, door };
                })
                .catch(() => ({ adv: null, door: null }));

              const prices = [];
              if (priceInfo.adv) {
                const advMatch = priceInfo.adv.match(/￥?([\d,]+)/);
                if (advMatch) {
                  prices.push({
                    price_tier: 'ADV',
                    amount: parseFloat(advMatch[1].replace(/,/g, '')),
                    currency: 'JPY',
                    discount_info: null,
                  });
                }
              }
              if (priceInfo.door) {
                const doorMatch = priceInfo.door.match(/￥?([\d,]+)/);
                if (doorMatch) {
                  prices.push({
                    price_tier: 'DOOR',
                    amount: parseFloat(doorMatch[1].replace(/,/g, '')),
                    currency: 'JPY',
                    discount_info: null,
                  });
                }
              }

              // Construct the event object
              const eventInfo = {
                title: title,
                organization: organization,
                description: description,
                date_start: date_start,
                date_end: date_end,
                time_start: time_start,
                time_end: time_end,
                venue_id: null, // Assuming venue is fixed; update if dynamic
                address: venueDetails.address,
                external_id: external_id,
                name: venueDetails.name,
                venue_address: venueDetails.address,
                city: venueDetails.city,
                postal_code: venueDetails.postal_code,
                country: venueDetails.country,
                schedule: [
                  {
                    date: date_start,
                    time_start: time_start,
                    time_end: time_end,
                    special_notes: null,
                  },
                ],
                status: 'upcoming', // Adjust based on current date if needed
                prices: prices,
                image_url: finalImageUrl,
                alt_text: title,
                is_featured: true,
                site: 'growly',
                event_link: detailUrl, // **Added Field**
              };

              // Validate essential fields
              if (!eventInfo.title || !eventInfo.date_start || !eventInfo.name || !eventInfo.event_link) {
                logger.warn(`Essential information missing for event: ${eventInfo.title}. Skipping event.`);
                continue;
              }

              // Download the image and get the local URL
              const localImageUrl = finalImageUrl && finalImageUrl !== 'No image available'
                ? await downloadImage(finalImageUrl, siteIdentifier, imagesDir)
                : '/images/events/growly/placeholder.jpg'; // Ensure this placeholder exists

              // Update the image_url to the local path
              eventInfo.image_url = localImageUrl;

              monthEventData.push(eventInfo);
              logger.info(`Extracted event data: ${JSON.stringify(eventInfo, null, 2)}`);
            } catch (error) {
              logger.error(`Error processing event ${eventIndex + 1} on ${date_start}: ${error.message}`);
            }
          }
        } catch (error) {
          logger.error(`Error processing date row ${dateIndex + 1} in ${year}-${month.toString().padStart(2, '0')}: ${error.message}`);
        }
      }

      // If no events were scraped for the month, return null
      if (monthEventData.length === 0) {
        logger.info(`No events found for ${year}-${month.toString().padStart(2, '0')}.`);
        return null;
      }

      logger.info(`Finished scraping ${monthEventData.length} events for ${year}-${month.toString().padStart(2, '0')}.`);
      return monthEventData;
    };

    // Get the current date
    const getCurrentYearMonth = () => {
      const now = new Date();
      return {
        year: now.getFullYear(),
        month: now.getMonth() + 1, // Months are 0-indexed in JavaScript
      };
    };

    // Function to increment month and handle year rollover
    const incrementMonth = (year, month) => {
      if (month === 12) {
        return { year: year + 1, month: 1 };
      }
      return { year: year, month: month + 1 };
    };

    // Initialize scraping parameters
    let { year, month } = getCurrentYearMonth();
    logger.info(`Starting scraping from ${year}-${month.toString().padStart(2, '0')}...`);

    const allEventData = [];

    while (true) {
      const monthEvents = await scrapeMonth(year, month);
      if (!monthEvents) {
        logger.info(`No more events found. Stopping scraper.`);
        break;
      }
      allEventData.push(...monthEvents);
      // Move to the next month
      ({ year, month } = incrementMonth(year, month));
      // Optional: Implement a limit to prevent infinite scraping
      // For example, scrape only up to 12 months ahead
      if (allEventData.length > 1000) { // Adjust as needed
        logger.warn('Scraped a large number of events. Stopping to prevent excessive scraping.');
        break;
      }
      // Optional: Delay between scraping months to respect server load
      await delay(2000); // 2 seconds
    }

    logger.info(`Total events scraped: ${allEventData.length}`);

    await browser.close();
    logger.info('Browser closed.');

    return allEventData;
  } catch (error) {
    logger.error(`Error during scraping: ${error.message}`);
    await browser.close();
    logger.info('Browser closed due to error.');
    return [];
  }
};

// Export the scraping function
export default scrapeGrowly;

// If the script is run directly, execute the scraping function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running Growly scraper...');
      const data = await scrapeGrowly();
      if (data.length > 0) {
        logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
        const outputPath = resolve(__dirnameESM, 'growly_events.json');
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        logger.info(`Data saved to ${outputPath}`);
      } else {
        logger.warn('No data scraped for site: growly');
      }
      logger.info('All scraping tasks completed.');
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}
