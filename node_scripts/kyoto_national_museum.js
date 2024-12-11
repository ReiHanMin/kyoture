// kyoto_national_museum.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';
import winston from 'winston';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Handle __dirname and __filename for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configure logger
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

// Predefined categories and tags
const predefinedCategories = ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports', 'Exhibition'];
const predefinedTags = [
    'Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama',
    'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class',
    'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure',
    'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening',
    'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market',
    'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event', 'Exhibition'
];

/**
 * Assign categories based on keywords in title and description
 * @param {string} title - The event title.
 * @param {string} description - The event description.
 * @returns {Array} - An array of assigned categories.
 */
const assignCategories = (title, description) => {
    const categories = new Set();
    const text = `${title} ${description}`.toLowerCase();

    predefinedCategories.forEach((category) => {
        const keyword = category.toLowerCase();
        if (text.includes(keyword)) {
            categories.add(category);
        }
    });

    // Ensure at least 'Exhibition' is included if related
    if (text.includes('exhibition')) {
        categories.add('Exhibition');
    }

    return Array.from(categories);
};

/**
 * Assign tags based on keywords in title and description
 * @param {string} title - The event title.
 * @param {string} description - The event description.
 * @returns {Array} - An array of assigned tags.
 */
const assignTags = (title, description) => {
    const tags = new Set();
    const text = `${title} ${description}`.toLowerCase();

    predefinedTags.forEach((tag) => {
        const keyword = tag.toLowerCase();
        if (text.includes(keyword)) {
            tags.add(tag);
        }
    });

    return Array.from(tags);
};

/**
 * Parses time strings like "9:00 a.m." into "HH:mm:ss"
 * @param {string} timeStr - The time string to parse.
 * @returns {string|null} - The parsed time in "HH:mm:ss" format or null if parsing fails.
 */
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

        return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
    }
    return null;
};

/**
 * Parses date ranges
 * @param {string} dateStr - The date string to parse.
 * @returns {Object} - An object containing date_start and date_end in "YYYY-MM-DD" format.
 */
const parseDateRange = (dateStr) => {
    let yearMatch = dateStr.match(/(\d{4})/);
    let year = yearMatch ? yearMatch[1] : null;

    if (!year || year.length < 4) {
        const currentYear = new Date().getFullYear();
        year = currentYear.toString();
        dateStr = dateStr.replace(/(\d{1,4})$/, year);
        logger.warn(`Incomplete year in date string. Assuming year as ${year}.`);
    }

    // Match date ranges like "April 19–June 15, 2025"
    const dateRangeMatch = dateStr.match(
        /([A-Za-z]+ \d{1,2})–([A-Za-z]+ \d{1,2}),?\s*(\d{4})/
    );
    // Match single dates like "April 19, 2025"
    const singleDateMatch = dateStr.match(/([A-Za-z]+ \d{1,2}),?\s*(\d{4})/);

    let date_start = null;
    let date_end = null;

    if (dateRangeMatch) {
        const startMonthDay = dateRangeMatch[1];
        const endMonthDay = dateRangeMatch[2];
        const year = dateRangeMatch[3];

        const startDateStr = `${startMonthDay}, ${year}`;
        const endDateStr = `${endMonthDay}, ${year}`;

        // Parse dates in UTC to prevent timezone shifts
        const startDate = new Date(startDateStr + ' UTC');
        const endDate = new Date(endDateStr + ' UTC');

        // Format dates as YYYY-MM-DD
        date_start = startDate.toISOString().split('T')[0];
        date_end = endDate.toISOString().split('T')[0];
    } else if (singleDateMatch) {
        const monthDay = singleDateMatch[1];
        const year = singleDateMatch[2];
        const dateStr = `${monthDay}, ${year}`;
        const date = new Date(dateStr + ' UTC');
        date_start = date.toISOString().split('T')[0];
        date_end = date_start;
    }

    return { date_start, date_end };
};

/**
 * Downloads an image from the given URL and saves it locally.
 * Ensures that images are saved with unique filenames based on their URL hashes.
 * Prevents duplicate downloads by checking existing files.
 * 
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'kyoto_national_museum').
 * @param {string} imagesDir - The directory where images are saved.
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, imagesDir, retries = 3) => {
    try {
        if (!imageUrl || imageUrl === 'No image available') {
            logger.warn('No valid image URL provided. Using placeholder.');
            return '/images/events/kyoto_national_museum/placeholder.jpg'; // Ensure this placeholder exists
        }

        // Ensure the image URL is absolute
        const absoluteImageUrl = imageUrl.startsWith('http')
            ? imageUrl
            : `https://www.kyohaku.go.jp${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

        logger.info(`Downloading image: ${absoluteImageUrl}`);

        // Parse the URL to remove query parameters for consistent hashing
        const parsedUrl = new URL(absoluteImageUrl);
        const normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname}`; // Excludes query params

        // Generate a unique filename using SHA256 hash of the normalized image URL
        const imageHash = crypto.createHash('sha256').update(normalizedUrl).digest('hex');
        let extension = path.extname(parsedUrl.pathname) || '.jpg'; // Handle URLs without extensions

        // If extension is not valid, attempt to get it from Content-Type
        if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(extension.toLowerCase())) {
            try {
                const headResponse = await axios.head(absoluteImageUrl, { timeout: 10000 });
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
                logger.warn(`Failed to fetch headers for image URL: ${absoluteImageUrl}. Using default extension '.jpg'. Error: ${headError.message}`);
                extension = '.jpg'; // Default extension
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
        return '/images/events/kyoto_national_museum/placeholder.jpg'; // Ensure this placeholder exists
    }
};

/**
 * Main scraping function for Kyoto National Museum
 * @returns {Array} - An array of event objects.
 */
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

                const fullTitle = subtitle ? `${subtitle} ${title}` : title;

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

                    // Handle cookie consent
                    const acceptButtonSelector = '#js-consentCookieButton'; // Updated selector based on provided HTML
                    try {
                        await detailPage.waitForSelector(acceptButtonSelector, { timeout: 5000 });
                        await detailPage.click(acceptButtonSelector);
                        logger.info('Cookie consent accepted.');
                        await delay(1000); // Wait after clicking to ensure the prompt is closed
                    } catch (e) {
                        logger.info('No cookie consent prompt found.');
                    }

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
                            if (!overview) return '';
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
                        // For Feature Exhibitions or other types
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
                            if (!contentsDiv) return '';
                            let descriptionText = '';
                            const paragraphs = contentsDiv.querySelectorAll('p');
                            paragraphs.forEach((p) => {
                                descriptionText += p.innerText.trim() + '\n';
                            });
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

                    // Assign categories and tags based on title and description
                    const categories = assignCategories(fullTitle, description);
                    const tags = assignTags(fullTitle, description);

                    // Generate external_id
                    const external_id =
                        'kyoto_national_museum_' +
                        eventLink.split('/').filter((part) => part).slice(-2).join('_');

                    // Download the main image
                    let localImageUrl = '/images/events/kyoto_national_museum/placeholder.jpg'; // Default to placeholder
                    if (imageUrl) {
                        try {
                            localImageUrl = await downloadImage(
                                imageUrl,
                                'kyoto_national_museum',
                                path.resolve(__dirname, '..', 'public', 'images', 'events', 'kyoto_national_museum')
                            );
                            logger.info(`Assigned local image URL for event ${index + 1}: ${localImageUrl}`);
                        } catch (error) {
                            logger.error(`Failed to download image for event ${index + 1}: ${error.message}`);
                            // Fallback to placeholder is already set
                        }
                    } else {
                        logger.warn(`No image URL found for event ${index + 1}. Using placeholder.`);
                    }

                    // Prepare event data
                    eventInfo = {
                        title: fullTitle,
                        date_start,
                        date_end,
                        venue,
                        organization: 'Kyoto National Museum',
                        image_url: localImageUrl, // Assigned above
                        event_link: eventLink,
                        schedule: [
                            {
                                date: date_start,
                                time_start,
                                time_end,
                                special_notes: null,
                            },
                        ],
                        categories,
                        tags,
                        prices, // Assign the prices variable here
                        description,
                        host: 'Kyoto National Museum',
                        ended: false,
                        free: prices.some((price) => price.amount === '0'), // Correctly reference the prices variable
                        external_id,
                        site: 'kyoto_national_museum',
                        address: '527 Chayamachi, Higashiyama Ward, Kyoto, 605-0931, Japan',
                    };

                    // Validate essential information
                    if (!eventInfo.title || !eventInfo.date_start || !eventInfo.venue) {
                        logger.warn(`Essential information missing for event: ${eventInfo.title}. Skipping event.`);
                        await detailPage.close();
                        continue;
                    }

                    // Assign categories and tags if not already assigned
                    if (!eventInfo.categories || eventInfo.categories.length === 0) {
                        eventInfo.categories = ['Exhibition'];
                    }
                    if (!eventInfo.tags || eventInfo.tags.length === 0) {
                        eventInfo.tags = [];
                    }

                    eventData.push(eventInfo);
                    logger.info(`Extracted structured event data: ${JSON.stringify(eventInfo)}`);

                    await detailPage.close();
                } 
            } // End of for-loop
            catch (error) {
              logger.error(`Error processing event ${index + 1}: ${error.message}`);
              // Continue to the next event
              continue;
          }
            
        } 
        logger.info('Final event data extraction complete.');
            await browser.close();
            logger.info('Browser closed.');
            return eventData; // Return the array directly after the loop
    }catch (error) {
      logger.error(`Error during scraping execution: ${error.message}`);
      await browser.close();
      logger.info('Browser closed due to an error.');
      return []; // Return an empty array in case of failure
  }
}


export default scrapeKyotoNationalMuseum;

// Execute the scraper if the script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    (async () => {
        try {
            logger.info('Running Kyoto National Museum scraper...');
            const data = await scrapeKyotoNationalMuseum();
            if (data.length > 0) {
                logger.info(`Scraped Data: ${JSON.stringify(data, null, 2)}`);
                const outputPath = path.resolve(__dirname, 'kyoto_national_museum_events.json');
                fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
                logger.info(`Data saved to ${outputPath}`);
            } else {
                logger.warn('No data scraped for Kyoto National Museum.');
            }
            logger.info('All scraping tasks completed.');
        } catch (error) {
            logger.error(`Error during scraping execution: ${error.message}`);
        }
    })();
}
