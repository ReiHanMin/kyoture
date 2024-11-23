// kyoto_fanj.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';
import crypto from 'crypto';

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
    new winston.transports.File({ filename: 'kyoto_fanj_scraper.log' }),
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

// Main scraping function for Kyoto-Fanj Events
const scrapeKyotoFanj = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 0,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  logger.info('Browser launched.');
  const page = await browser.newPage();
  logger.info('New page opened.');

  try {
    logger.info('Navigating to Kyoto-Fanj schedule page...');
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    const scrapeUrl = process.env.SCRAPE_URL || 'http://www.kyoto-fanj.com/schedule.html';
    await page.goto(scrapeUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    logger.info('Page loaded.');

    // Wait for the main schedule container to load
    await page.waitForSelector('#schedule_main', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for #schedule_main selector.');
    });

    // Extract all event containers (divs with both schedule_box and anchor classes)
    const eventContainers = await page.$$('div.schedule_box.anchor');

    logger.info(`Found ${eventContainers.length} event containers.`);
    const eventData = [];

    for (const [index, container] of eventContainers.entries()) {
      try {
        logger.info(`Processing event ${index + 1} of ${eventContainers.length}...`);

        // Extract left section
        const leftSection = await container.$('.schedule_box_inner_l');
        if (!leftSection) {
          logger.warn(`Missing left section for event ${index + 1}. Skipping.`);
          continue;
        }

        // Extract right section
        const rightSection = await container.$('.schedule_box_inner_r');
        if (!rightSection) {
          logger.warn(`Missing right section for event ${index + 1}. Skipping.`);
          continue;
        }

        // Extract date components
        const monthText = await leftSection.$eval('td.date p:nth-child(1)', (el) => el.innerText.trim()).catch(() => null);
        const dayText = await leftSection.$eval('td.date p:nth-child(2)', (el) => {
          // Split by <br> tag if present
          const br = el.querySelector('br');
          return br ? el.innerText.split('\n')[0].trim() : el.innerText.trim();
        }).catch(() => null);

        if (!monthText || !dayText) {
          logger.warn(`Missing month or day for event ${index + 1}. Skipping.`);
          continue;
        }

        // Assuming current year
        const currentYear = new Date().getFullYear();
        const month = monthText.padStart(2, '0');
        const day = dayText.padStart(2, '0');
        const date_start = `${currentYear}-${month}-${day}`;
        const date_end = date_start; // Assuming single-day events

        // Extract image URL
        let imageUrl = await leftSection.$eval('td img', (img) => img.src).catch(() => null);
        if (imageUrl && !imageUrl.startsWith('http')) {
          // Handle relative URLs
          imageUrl = new URL(imageUrl, scrapeUrl).href;
        }
        if (!imageUrl) {
          imageUrl = process.env.DEFAULT_IMAGE_URL || '';
        }

        // Extract event title
        const titleElements = await leftSection.$$eval('h3.title', (els) => els.map((el) => el.innerText.trim()));
        const eventTitle = titleElements.join(' ').replace(/<[^>]+>/g, '').trim();
        if (!eventTitle) {
          logger.warn(`Missing event title for event ${index + 1}. Skipping.`);
          continue;
        }

        // Override organization to always be "Kyoto Fanj"
        const organization = 'Kyoto Fanj';

        // Generate external_id
        const external_id = generateExternalId(eventTitle, date_start);

        // Extract data from the right section
        const details = await rightSection.$$eval('dl', (dlElements) => {
          const data = {};
          dlElements.forEach((dl) => {
            const dtElements = dl.querySelectorAll('dt');
            dtElements.forEach((dt) => {
              const key = dt.innerText.trim();
              const dd = dt.nextElementSibling;
              if (dd) {
                data[key] = dd.innerHTML.trim();
              }
            });
          });
          return data;
        });

        // Parse opening and start times
        let time_start = null;
        let time_end = null;
        if (details['開場/開演']) {
          // Extract times using regex
          const timeMatch = details['開場/開演'].match(/開場\s*(\d{1,2}:\d{2})\s*開演\s*(\d{1,2}:\d{2})/);
          if (timeMatch) {
            time_start = timeMatch[2];
            // time_end not provided
          } else {
            const simpleTimeMatch = details['開場/開演'].match(/開場\s*(\d{1,2}:\d{2})/);
            if (simpleTimeMatch) {
              time_start = simpleTimeMatch[1];
            }
          }
        }

        // Parse pricing information
        const prices = [];
        if (details['料金']) {
          // Replace <br> with \n and split
          const priceLines = details['料金']
            .replace(/<br\s*\/?>/gi, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          priceLines.forEach((line) => {
            // Handle multiple price tiers in a single line
            // Example formats:
            // "VIP ¥20,000 S ¥8,000"
            // "前売￥7,500(税込)"
            const regex = /([A-Za-zぁ-んァ-ン一-龥]+)\s*[¥￥]?([\d,]+)(?:\(([^)]+)\))?/g;
            let match;
            while ((match = regex.exec(line)) !== null) {
              const price_tier = match[1].trim();
              const amount_str = match[2].replace(/,/g, '');
              const amount = parseFloat(amount_str);
              const currency = 'JPY';
              const discount_info = match[3] ? match[3].trim() : null;
              prices.push({
                price_tier,
                amount: isNaN(amount) ? null : amount,
                currency,
                discount_info,
              });
            }
          });
        }

        // Parse general sale date
        let general_sale_date = null;
        if (details['一般発売']) {
          const saleDateMatch = details['一般発売'].match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})?～?/);
          if (saleDateMatch) {
            const month = saleDateMatch[1].padStart(2, '0');
            const day = saleDateMatch[2].padStart(2, '0');
            const year = currentYear;
            general_sale_date = `${year}-${month}-${day}`;
          }
        }

        // Parse seating arrangement
        const seating = details['座席形態']
          ? details['座席形態'].replace(/<[^>]+>/g, '').trim()
          : null;

        // Parse contact information
        const contact = details['お問合せ']
          ? details['お問合せ'].replace(/<[^>]+>/g, '').trim()
          : null;

        // Parse special notes
        const special_notes = details['備考']
          ? details['備考'].replace(/<[^>]+>/g, '').trim()
          : null;

        // Determine event status based on date
        let status = 'upcoming';
        if (date_start) {
          const eventDate = new Date(date_start);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (eventDate < today) {
            status = 'ended';
          }
        }

        // Extract alt text for image
        let alt_text = await leftSection.$eval('td img', (img) => img.alt).catch(() => null);

        // Determine if the image is featured (assuming all are featured)
        const is_featured = true;

        // Construct event object
        const eventInfo = {
          title: eventTitle,
          organization: organization || null, // Overridden to "Kyoto Fanj"
          description: null, // No description available in the provided HTML
          date_start: date_start || null,
          date_end: date_end || null,
          time_start: isValidTime(time_start) ? time_start : null,
          time_end: isValidTime(time_end) ? time_end : null,
          venue_id: null, // To be assigned separately if managing venues
          address: null, // Optional: Not provided
          external_id: external_id,
          // Venue details can be handled separately or included here if needed
          // venue: {
          //   name: 'Kyoto FANJ',
          //   address: '',
          //   city: 'Kyoto',
          //   postal_code: '',
          //   country: 'Japan',
          // },
          schedules: [
            {
              date: date_start || null,
              time_start: isValidTime(time_start) ? time_start : null,
              time_end: isValidTime(time_end) ? time_end : null,
              special_notes: special_notes || null,
              status: status,
            },
          ],
          prices: prices.length > 0 ? prices : null,
          image_url: imageUrl || process.env.DEFAULT_IMAGE_URL || '',
          alt_text: alt_text || null,
          is_featured: is_featured,
          event_link: 'http://www.kyoto-fanj.com/schedule.html', // Fixed event link
          // Additional fields as per user's schema
          site: 'kyoto_fanj',
        };

        // Validate essential fields
        if (!eventInfo.title || !eventInfo.date_start) {
          logger.warn(`Essential information missing for event ${index + 1}. Skipping.`);
          continue;
        }

        eventData.push(eventInfo);
        logger.info(`Extracted event: ${eventTitle}`);
      } catch (error) {
        logger.error(`Error processing event ${index + 1}: ${error.message}`);
      }
    }

    logger.info('Final event data extraction complete.');
    await browser.close();
    logger.info('Browser closed.');
    return eventData;
  } catch (error) {
    logger.error(`Error during scraping: ${error.message}`);
    await browser.close();
    logger.info('Browser closed due to error.');
    return [];
  }
};

export default scrapeKyotoFanj;

// Execute the scraper if the script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running Kyoto-Fanj scraper...');
      const data = await scrapeKyotoFanj();
      logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
      const outputPath = resolve(__dirnameESM, 'kyoto_fanj_events.json');
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`Data saved to ${outputPath}`);
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}
