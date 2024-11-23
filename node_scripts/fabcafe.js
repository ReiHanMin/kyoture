// fabcafe.js

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

// Main scraping function for FabCafe Kyoto Events
const scrapeFabCafe = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 0,
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

    // Wait for the main events container to load
    await page.waitForSelector('.event-slide-col1-list', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for .event-slide-col1-list selector.');
    });

    // Extract all event containers
    const eventElements = await page.$$('.event-slide-elm');
    logger.info(`Found ${eventElements.length} events on the listing page.`);

    const eventsData = [];

    for (const [index, eventElement] of eventElements.entries()) {
      try {
        logger.info(`Processing event ${index + 1} of ${eventElements.length}...`);

        // Extract the event URL
        const eventUrl = await eventElement.$eval('a', (el) => el.href).catch(() => null);
        if (!eventUrl) {
          logger.warn(`Missing event URL for event ${index + 1}. Skipping.`);
          continue;
        }

        // Extract event title
        const eventTitle = await eventElement.$eval('div.top-info > h2.ttl', (el) =>
          el.innerText.trim()
        ).catch(() => null);

        if (!eventTitle) {
          logger.warn(`Missing event title for event ${index + 1}. Skipping.`);
          continue;
        }

        // Extract event description (short description)
        const eventDescription = await eventElement.$eval('div.top-info > p.text', (el) =>
          el.innerText.trim()
        ).catch(() => null);

        // Extract image URL
        let imageUrl = await eventElement.$eval(
          'div.img-box > div.img > div.posi-full.bg-style',
          (el) => el.getAttribute('data-bg')
        ).catch(() => null);

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
        const detailedEventData = await extractEventDetails(eventPage, eventData);

        await eventPage.close();

        // Validate essential fields
        if (!detailedEventData.title || !detailedEventData.date_start) {
          logger.warn(`Essential information missing for event ${index + 1}. Skipping.`);
          continue;
        }

        eventsData.push(detailedEventData);
        logger.info(`Extracted event: ${eventTitle}`);
      } catch (error) {
        logger.error(`Error processing event ${index + 1}: ${error.message}`);
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

// Function to extract detailed event data from the event detail page
const extractEventDetails = async (eventPage, eventData) => {
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
    }

    // Extract event description
    const detailDescription = await eventPage.$$eval('div.right-box.bs-b.wysiwyg p', (elements) =>
      elements.map((el) => el.innerText.trim()).join('\n\n')
    ).catch(() => null);
    if (detailDescription) {
      eventData.description = detailDescription;
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
      } else {
        // Single day event
        const singleDateMatch = dateText.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
        if (singleDateMatch) {
          eventData.date_start = `${singleDateMatch[1]}-${singleDateMatch[2].padStart(2, '0')}-${singleDateMatch[3].padStart(2, '0')}`;
          eventData.date_end = eventData.date_start;
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
      } else {
        // Handle cases like "11:00 – 19:00 水曜日・土曜日開催"
        const timeOnlyMatch = timeText.match(/(\d{1,2}:\d{2})\s*–\s*(\d{1,2}:\d{2})/);
        if (timeOnlyMatch) {
          eventData.time_start = timeOnlyMatch[1];
          eventData.time_end = timeOnlyMatch[2];
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
      }
    }

    eventData.prices = prices.length > 0 ? prices : null;

    // Determine if the event is free
    eventData.free = prices.length === 0;

    // Create schedules
    eventData.schedules = [
      {
        date: eventData.date_start,
        time_start: isValidTime(eventData.time_start) ? eventData.time_start : null,
        time_end: isValidTime(eventData.time_end) ? eventData.time_end : null,
        special_notes: null, // Add any special notes if available
        status: 'upcoming', // Determine based on current date
      },
    ];

    return eventData;
  } catch (error) {
    logger.error(`Error extracting event details: ${error.message}`);
    return eventData; // Return what we have so far
  }
};

// Helper function to convert abbreviated month to number
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

export default scrapeFabCafe;

// Execute the scraper if the script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running FabCafe Kyoto scraper...');
      const data = await scrapeFabCafe();
      logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
      const outputPath = resolve(__dirnameESM, 'fabcafe_kyoto_events.json');
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`Data saved to ${outputPath}`);
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}
