// kyoto_national_museum_scraper.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import winston from 'winston';

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
    new winston.transports.File({ filename: 'kyoto_national_museum_scraper.log' }),
  ],
});

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Define __filename and __dirname for ES modules
const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

// Helper function to parse time strings like "9:00 a.m." into "HH:mm"
const parseTime = (timeStr) => {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3].toLowerCase();

    if (period === 'p.m.' && hours !== 12) {
      hours += 12;
    } else if (period === 'a.m.' && hours === 12) {
      hours = 0;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  }
  return null;
};

// Function to parse date ranges
const parseDateRange = (dateStr) => {
  // Remove any non-digit characters from the year and check its length
  let yearMatch = dateStr.match(/(\d{4})/);
  let year = yearMatch ? yearMatch[1] : null;

  if (!year || year.length < 4) {
    // If the year is incomplete or missing, assume the current or next year
    const currentYear = new Date().getFullYear();
    year = currentYear.toString();
    dateStr = dateStr.replace(/(\d{1,4})$/, year);
  }

  // Match date ranges like "January 2–February 9, 2025"
  const dateRangeMatch = dateStr.match(
    /([A-Za-z]+ \d{1,2})–([A-Za-z]+ \d{1,2}),?\s*(\d{4})/
  );
  // Match single dates like "January 2, 2025"
  const singleDateMatch = dateStr.match(/([A-Za-z]+ \d{1,2}),?\s*(\d{4})/);

  let date_start = null;
  let date_end = null;

  if (dateRangeMatch) {
    const startMonthDay = dateRangeMatch[1];
    const endMonthDay = dateRangeMatch[2];
    const year = dateRangeMatch[3];

    const startDateStr = `${startMonthDay}, ${year}`;
    const endDateStr = `${endMonthDay}, ${year}`;
    date_start = new Date(startDateStr).toISOString().split('T')[0];
    date_end = new Date(endDateStr).toISOString().split('T')[0];
  } else if (singleDateMatch) {
    const monthDay = singleDateMatch[1];
    const year = singleDateMatch[2];
    const dateStr = `${monthDay}, ${year}`;
    date_start = new Date(dateStr).toISOString().split('T')[0];
    date_end = date_start;
  }

  return { date_start, date_end };
};

// Main scraping function for Kyoto National Museum
const scrapeKyotoNationalMuseum = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 0,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  logger.info('Browser launched.');
  const page = await browser.newPage();
  logger.info('New page opened.');

  try {
    logger.info('Navigating to Kyoto National Museum exhibitions page...');
    await page.setUserAgent(
      process.env.USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    const scrapeUrl = process.env.SCRAPE_URL || 'https://www.kyohaku.go.jp/eng/exhibitions/';
    await page.goto(scrapeUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    logger.info('Page loaded.');

    // Wait for the exhibition list to load
    await page.waitForSelector('.exhibitionList__item', { timeout: 30000 }).catch(() => {
      logger.warn('Timeout waiting for exhibition list items.');
    });

    const eventElements = await page.$$('.exhibitionList__item');
    logger.info(`Found ${eventElements.length} event items.`);
    const eventData = [];

    for (const [index, eventElement] of eventElements.entries()) {
      try {
        logger.info(`Processing event ${index + 1} of ${eventElements.length}...`);

        // Extract data from the main page
        const eventLink = await eventElement
          .$eval('a', (el) => el.href)
          .catch(() => null);

        const imageUrl = await eventElement
          .$eval('.exhibitionList__img img', (img) => img.src)
          .catch(() => null);

        const title = await eventElement
          .$eval('.exhibitionList__title', (el) => el.innerText.trim())
          .catch(() => 'Untitled Event');

        const subtitle = await eventElement
          .$eval('.exhibitionList__cap.gray.bold', (el) => el.innerText.trim())
          .catch(() => '');

        const fullTitle = subtitle ? `${subtitle}\n${title}` : title;

        let dateText = await eventElement
          .$eval('.exhibitionList__date p', (el) => el.innerText.trim())
          .catch(() => null);

        // Fix incomplete dateText if necessary
        if (dateText && dateText.endsWith(',')) {
          dateText += ` ${new Date().getFullYear()}`;
        }

        logger.info(`Event Title: ${fullTitle}`);
        logger.info(`Event Link: ${eventLink}`);
        logger.info(`Date Text: ${dateText}`);

        // Initialize date_start and date_end
        let date_start = null;
        let date_end = null;

        // Parse date_start and date_end from dateText
        if (dateText) {
          const dates = parseDateRange(dateText);
          date_start = dates.date_start;
          date_end = dates.date_end;
          if (!date_start || !date_end) {
            logger.warn(`Unrecognized date format: ${dateText}`);
          }
        }

        let eventInfo = {};

        if (index < 6 && eventLink) {
          // For the first six events, navigate to detail page
          logger.info(`Navigating to event detail page: ${eventLink}`);
          const detailPage = await browser.newPage();
          await detailPage.setUserAgent(
            process.env.USER_AGENT ||
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
          );

          await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await delay(2000); // Ensure full load of page content

          // Determine if the page is a Special Exhibition or Feature Exhibition
          const isSpecialExhibition = await detailPage.$('.overviewArea');
          let generalInfo = {};
          let description = '';

          if (isSpecialExhibition) {
            // Extract general information from the detail page for Special Exhibitions
            generalInfo = await detailPage.$$eval('.overviewArea dl', (dls) => {
              const data = {};
              dls.forEach((dl) => {
                const dt = dl.querySelector('dt');
                const dd = dl.querySelector('dd');
                if (dt && dd) {
                  const key = dt.innerText.trim();
                  const value = dd.innerText.trim();
                  data[key] = value;
                }
              });
              return data;
            });

            // Extract description for Special Exhibitions
            description = await detailPage.evaluate(() => {
              const overview = document.querySelector('.overviewArea');
              let nextSibling = overview.nextElementSibling;
              while (nextSibling && !nextSibling.classList.contains('contents')) {
                nextSibling = nextSibling.nextElementSibling;
              }
              if (nextSibling) {
                return nextSibling.innerText.trim();
              }
              return '';
            });
          } else {
            // For Feature Exhibitions
            generalInfo = await detailPage.$$eval('.overviewArea dl', (dls) => {
              const data = {};
              dls.forEach((dl) => {
                const dt = dl.querySelector('dt');
                const dd = dl.querySelector('dd');
                if (dt && dd) {
                  const key = dt.innerText.trim();
                  const value = dd.innerText.trim();
                  data[key] = value;
                }
              });
              return data;
            });

            // Extract description for Feature Exhibitions
            description = await detailPage.evaluate(() => {
              const contentsDiv = document.querySelector('.contents');
              let descriptionText = '';
              if (contentsDiv) {
                const paragraphs = contentsDiv.querySelectorAll('p');
                paragraphs.forEach((p) => {
                  descriptionText += p.innerText.trim() + '\n';
                });
              }
              return descriptionText.trim();
            });
          }

          logger.info(`General Information: ${JSON.stringify(generalInfo)}`);

          // Parse date_start and date_end from generalInfo if not already parsed
          if (!date_start || !date_end) {
            if (generalInfo['Period']) {
              const dates = parseDateRange(generalInfo['Period']);
              date_start = dates.date_start;
              date_end = dates.date_end;
            }
          }

          // Get venue
          const venue = generalInfo['Venue'] || 'Kyoto National Museum';

          // Get time_start and time_end
          let time_start = null;
          let time_end = null;
          const hoursText =
            generalInfo['Special Exhibition Hours'] || generalInfo['Museum Hours'] || '';

          if (hoursText) {
            // Match time ranges like "9:00 a.m.–5:30 p.m."
            const timeMatch = hoursText.match(
              /(\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.))–(\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.))/i
            );
            if (timeMatch) {
              const startTimeStr = timeMatch[1];
              const endTimeStr = timeMatch[2];
              time_start = parseTime(startTimeStr);
              time_end = parseTime(endTimeStr);
            }
          }

          // Get prices
          let prices = [];

          // First, try to extract prices from 'Special Exhibition Admission' or 'Admission' in generalInfo
          const admissionInfo =
            generalInfo['Special Exhibition Admission'] || generalInfo['Admission'] || '';

          if (admissionInfo) {
            // Extract prices from the table under the admission section
            prices = await detailPage
              .$$eval('table.borderHorizon tr', (rows) => {
                const prices = [];
                rows.forEach((row) => {
                  const th = row.querySelector('th');
                  const td = row.querySelector('td');
                  if (th && td) {
                    const price_tier = th.innerText.trim();
                    const amountText = td.innerText.trim();
                    const amountMatch = amountText.match(/([\d,]+) yen/);
                    if (amountMatch) {
                      const amount = amountMatch[1].replace(/,/g, '');
                      prices.push({
                        price_tier,
                        amount,
                        currency: 'JPY',
                        discount_info: null,
                      });
                    }
                  }
                });
                return prices;
              })
              .catch(() => []);
          }

          // Generate external_id
          const external_id =
            'kyoto_national_museum_' + eventLink.split('/').slice(-2).join('_');

          // Prepare event data
          eventInfo = {
            title: fullTitle,
            date_start,
            date_end,
            time_start,
            time_end,
            venue,
            organization: 'Kyoto National Museum',
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
            description,
            event_link: eventLink,
            categories: ['Exhibition'],
            tags: [],
            ended: false,
            free: false, // Assuming events are not free unless specified
            site: 'kyoto_national_museum',
            external_id,
          };

          await detailPage.close();
        } else {
          // For events from 7 onwards, scrape from main page
          let time_start = null;
          let time_end = null;
          let prices = [];

          // Assume standard prices for collection exhibitions
          prices = [
            {
              price_tier: 'Adult',
              amount: '700',
              currency: 'JPY',
              discount_info: null,
            },
            {
              price_tier: 'University Student (ID required)',
              amount: '350',
              currency: 'JPY',
              discount_info: null,
            },
          ];

          // Generate external_id
          const external_id =
            'kyoto_national_museum_' + eventLink.split('/').slice(-2).join('_');

          // Prepare event data
          eventInfo = {
            title: fullTitle,
            date_start,
            date_end,
            time_start,
            time_end,
            venue: 'Kyoto National Museum',
            organization: 'Kyoto National Museum',
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
            description: '', // No description available
            event_link: eventLink,
            categories: ['Exhibition'],
            tags: [],
            ended: false,
            free: false,
            site: 'kyoto_national_museum',
            external_id,
          };
        }

        // Add address information for the venue
        const address = '527 Chayamachi, Higashiyama Ward, Kyoto, 605-0931, Japan';

        eventInfo.address = address;

        if (!eventInfo.title || !eventInfo.date_start || !eventInfo.venue) {
          logger.warn(
            `Essential information missing for event: ${fullTitle}. Skipping event.`
          );
          continue;
        }

        eventData.push(eventInfo);
        logger.info(`Extracted structured event data: ${JSON.stringify(eventInfo)}`);

      } catch (error) {
        logger.error(`Error processing event ${index + 1}: ${error.message}`);
        // Continue to the next event
        continue;
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

export default scrapeKyotoNationalMuseum;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      logger.info('Running Kyoto National Museum scraper...');
      const data = await scrapeKyotoNationalMuseum();
      logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
      const outputPath = resolve(__dirnameESM, 'kyoto_national_museum_events.json');
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`Data saved to ${outputPath}`);
    } catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
    }
  })();
}
