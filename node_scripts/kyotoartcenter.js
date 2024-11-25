// kyoto_art_center_scraper.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import winston from 'winston';
import { fileURLToPath } from 'url';

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
    new winston.transports.File({ filename: 'kyoto_art_center_scraper.log' }),
  ],
});

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to validate time format
const isValidTime = (timeStr) => {
  return /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.test(timeStr);
};

// Function to extract event data from a single event page
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
          const priceMatch = line.match(/([^\d¥￥]+)\s*[¥￥]?(\d{1,3}(,\d{3})*(\.\d+)*)/);
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
            const amountMatch = line.match(/[¥￥]?(\d{1,3}(,\d{3})*(\.\d+)*)/);
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
    const external_id = 'kyoto_art_center_' + path.basename(eventLink);

    // Prepare event data
    const eventInfo = {
      title,
      organization,
      description,
      date_start,
      date_end,
      venue,
      external_id,
      image_url: imageUrl,
      schedule: [
        {
          date: date_start,
          time_start,
          time_end,
          special_notes: null,
        },
      ],
      prices,
      event_link: eventLink,
      categories: [], // You can populate categories based on 'ジャンル' or 'カテゴリー' fields
      tags: [], // You can populate tags based on 'ジャンル' or 'カテゴリー' fields
      site: 'kyoto_art_center',
    };

    await eventPage.close();

    return eventInfo;
  } catch (error) {
    logger.error(`Error processing event at ${eventLink}: ${error.message}`);
    return null;
  }
};

// Main scraping function
const scrapeKyotoArtCenter = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 0,
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

      await page.waitForSelector('ul.eventsList.listType-thumb', { timeout: 30000 });

      // Extract event links
      const eventLinks = await page.$$eval('ul.eventsList.listType-thumb li.listItem > a', (links) =>
        links.map((a) => a.href)
      );

      logger.info(`Found ${eventLinks.length} event links on page: ${eventsUrl}`);

      for (const eventLink of eventLinks) {
        const eventInfo = await extractEventData(eventLink, browser);
        if (eventInfo) {
          eventData.push(eventInfo);
          logger.info(`Extracted event: ${eventInfo.title}`);
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

export default scrapeKyotoArtCenter;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running Kyoto Art Center scraper...');
      const data = await scrapeKyotoArtCenter();
      logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
      // Save data to a JSON file
      fs.writeFileSync('kyoto_art_center_events.json', JSON.stringify(data, null, 2), 'utf-8');
      logger.info('Data saved to kyoto_art_center_events.json');
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}
