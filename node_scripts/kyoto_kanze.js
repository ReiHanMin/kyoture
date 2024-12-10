// scrapeKyotoKanze.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import crypto from 'crypto';
import PQueue from 'p-queue';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

// Configure Puppeteer to use Stealth Plugin
puppeteer.use(StealthPlugin());

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Logger
const logger = winston.createLogger({
    level: 'debug', // Set to 'debug' for detailed logs
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
    ),
    transports: [
        new winston.transports.File({ filename: path.join(__dirname, 'logs', 'scraper.log') }),
        new winston.transports.Console()
    ]
});

// Utility Functions

/**
 * Delay execution for given milliseconds
 * @param {number} ms 
 * @returns {Promise}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert full-width characters to half-width
 * @param {string} str 
 * @returns {string}
 */
const toHalfWidth = (str) =>
    str
        .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, ' '); // Convert full-width space to half-width

/**
 * Normalize event titles by removing known prefixes and trimming whitespace
 * @param {string} title 
 * @returns {string}
 */
function normalizeTitle(title) {
    return title
        .replace(/^(Kyoto Kanze|林能楽会|橋本聲吟社|fever)\s*[-：:]\s*/i, '')
        .replace(/<[^>]+>/g, '') // Remove any remaining HTML tags
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .trim();
}

/**
 * Parse date and time from Japanese format
 * @param {string} dateTimeStr 
 * @returns {object|null}
 */
function parseJapaneseDateTime(dateTimeStr) {
    // Regex to match "MM月DD日(曜日) HH:MM開演" or "MM月DD日(曜日) 開演時間未定"
    const regex = /(\d{1,2})月(\d{1,2})日\s*\((?:日|月|火|水|木|金|土|祝)\D*\)\s*(?:(\d{1,2}):(\d{2})開演|開演時間未定)/;
    const match = regex.exec(dateTimeStr);

    if (match) {
        const month = match[1].padStart(2, '0');
        const day = match[2].padStart(2, '0');
        const currentYear = new Date().getFullYear();
        const year = currentYear; // Adjust if events span multiple years

        let date_start = `${year}-${month}-${day}`;
        let date_end = date_start;
        let time_start = null;
        let time_end = null;

        if (match[3] && match[4]) {
            time_start = `${match[3].padStart(2, '0')}:${match[4]}`;
            // Optionally, set a default duration if end time is not provided
            // For example, assume 2 hours duration:
            // const [hour, minute] = [parseInt(match[3]), parseInt(match[4])];
            // const endHour = (hour + 2) % 24;
            // time_end = `${endHour.toString().padStart(2, '0')}:${match[4]}`;
        } else if (dateTimeStr.includes('開演時間未定')) {
            time_start = null; // Or assign a default value like 'To Be Announced'
        }

        return { date_start, date_end, time_start, time_end };
    }

    return null;
}

/**
 * Generate a SHA256 hash for a given string
 * @param {string} str 
 * @returns {string}
 */
function generateHash(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Make absolute URL from relative URL and base URL
 * @param {string} url 
 * @param {string} base 
 * @returns {string|null}
 */
function makeAbsoluteUrl(url, base) {
    try {
        const baseUrl = new URL(base);
        // Ensure base URL ends with a slash
        if (!baseUrl.pathname.endsWith('/')) {
            baseUrl.pathname += '/';
        }
        return new URL(url, baseUrl).href;
    } catch (e) {
        logger.error(`Invalid URL: ${url} with base: ${base}`);
        return null; // Return null to handle invalid URLs
    }
}

/**
 * Downloads an image from the given URL and saves it locally.
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'kyoto_kanze').
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadAndSaveImage = async (imageUrl, site, retries = 3) => {
    if (!imageUrl) {
        logger.warn('No image URL provided. Assigning placeholder.');
        return '/images/events/kyoto_kanze/placeholder.jpg';
    }

    const absoluteImageUrl = imageUrl.startsWith('http') ? imageUrl : makeAbsoluteUrl(imageUrl, 'https://kyoto-kanze.jp');
    if (!absoluteImageUrl) {
        logger.warn('Invalid image URL. Assigning placeholder.');
        return '/images/events/kyoto_kanze/placeholder.jpg';
    }

    logger.debug(`Attempting to download image from URL: ${absoluteImageUrl}`);

    try {
        const response = await axios.get(absoluteImageUrl, { responseType: 'arraybuffer' });

        // Check if the response content type is an image
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
            throw new Error(`Invalid content type: ${contentType}`);
        }

        const extension = path.extname(new URL(absoluteImageUrl).pathname) || '.jpg';
        const filename = `${uuidv4()}${extension}`;
        const filepath = path.join(__dirname, '..', 'public', 'images', 'events', site, filename);

        // Ensure the directory exists
        await fs.mkdir(path.dirname(filepath), { recursive: true });

        // Save the image file
        await fs.writeFile(filepath, response.data);

        const relativeImageUrl = `/images/events/${site}/${filename}`;
        logger.debug(`Image successfully saved: ${relativeImageUrl}`);
        return relativeImageUrl;
    } catch (error) {
        if (retries > 0) {
            logger.warn(`Retrying download (${retries} attempts left) for URL: ${absoluteImageUrl}`);
            await delay(1000);
            return downloadAndSaveImage(imageUrl, site, retries - 1);
        }
        logger.error(`Failed to download image after retries. Assigning placeholder. Error: ${error.message}`);
        return '/images/events/kyoto_kanze/placeholder.jpg';
    }
};


/**
 * Parse price information from text
 * @param {string} text 
 * @returns {Array}
 */
function parsePrices(text) {
    const prices = [];

    // Clean the text by removing HTML tags and unnecessary whitespace
    const cleanText = text.replace(/<[^>]+>/g, '').replace(/\u00A0/g, ' ').trim();

    // Split the text into lines for line-by-line processing
    const lines = cleanText.split('\n');

    // Define a mapping for common price tiers (can be expanded as needed)
    const priceTierMapping = {
        '正面指定席': 'Front Reserved Seat',
        '脇中正面指定席': 'Side & Middle Front Reserved Seat',
        '次世代応援シート': 'Next Generation Support Sheet',
        '各当日券': 'General Day Ticket',
        '学生席': 'Student Seat',
        '当日': 'Day Ticket',
        '学生': 'Student Ticket',
        '前売券': 'Advance Ticket',
        '当日券': 'Day Ticket',
        '１階': 'First Floor Seat',
        '２階': 'Second Floor Seat',
        'Ｓ席': 'S Seat',
        'Ａ席': 'A Seat',
        'Ｂ席': 'B Seat',
        '料金': 'Fee',
        '一般前売指定席券※WEB': 'General Advance Reserved Seat (WEB)',
        '一般前売自由席券': 'General Advance Free Seat',
        '学生券２階自由席のみ': 'Student Ticket - Second Floor Free Seat Only',
        '特別会員会員券10枚': 'Special Member Ticket (10 pcs)',
        '普通会員会員券10枚': 'Regular Member Ticket (10 pcs)',
        'Free': 'Free',
        // Add more mappings as necessary
    };

    let lastPriceTier = null;

    // Enhanced Regex to capture more complex patterns
    const labeledPriceRegex = /^([^\s￥]+(?:席|券|シート|パートナー|料金|Free))\s*￥([\d,]+)/i;
    const amountOnlyRegex = /^￥([\d,]+)/;

    for (let line of lines) {
        line = line.trim();

        if (line === '') continue; // Skip empty lines

        let match = labeledPriceRegex.exec(line);
        if (match) {
            // Line has both label and amount
            let label = match[1].trim();
            let amount = match[2].replace(/,/g, '');

            // Clean and map the label
            label = label.replace(/[･・ー()（）]/g, '').trim(); // Remove specific and parenthesis characters
            label = priceTierMapping[label] || label; // Map to standardized label

            prices.push({
                price_tier: label,
                amount: parseFloat(amount),
                currency: 'JPY',
            });

            lastPriceTier = label; // Update the last known price tier
            continue;
        }

        match = amountOnlyRegex.exec(line);
        if (match && lastPriceTier) {
            // Line has only amount, assign it to the last known price tier
            let amount = match[1].replace(/,/g, '');

            prices.push({
                price_tier: lastPriceTier,
                amount: parseFloat(amount),
                currency: 'JPY',
            });

            continue;
        }

        // Handle "無料" mentions
        if (/無料/.test(line)) {
            prices.push({ price_tier: 'Free', amount: 0, currency: 'JPY' });
            continue;
        }

        // Handle discounts or other modifiers
        if (/割引/.test(line)) {
            // Extract the amount and assign a 'Discount' tier
            const discountMatch = /￥([\d,]+)/.exec(line);
            if (discountMatch) {
                let discountAmount = parseFloat(discountMatch[1].replace(/,/g, ''));
                prices.push({
                    price_tier: 'Discount',
                    amount: discountAmount,
                    currency: 'JPY',
                });
            }
            continue;
        }

        // If line doesn't match any pattern, log it for further inspection
        logger.warn(`Unrecognized price line format: "${line}"`);
    }

    return prices;
}

/**
 * Extract text from HTML comments
 * @param {string} html 
 * @returns {string}
 */
function extractTextFromComments(html) {
    const commentRegex = /<!--([\s\S]*?)-->/g;
    let match;
    let comments = [];
    while ((match = commentRegex.exec(html)) !== null) {
        comments.push(match[1]);
    }
    return comments.join('\n');
}

/**
 * Extract high-resolution image URLs from detail page
 * @param {object} page 
 * @param {string} baseUrl 
 * @returns {Array}
 */
const extractHighResImages = async (page, baseUrl) => {
    logger.debug(`Extracting high-res images from page: ${baseUrl}`);
    const imageSelectors = [
        'div.event-images img[src]',
        'div.event-images a[href]',
    ];

    const imgUrls = await page.$$eval('div.left .link a[href$="_l.jpg"]', (anchors) =>
    anchors.map((a) => a.href)
);



    const absoluteUrls = imgUrls
        .map(imgUrl => (imgUrl.startsWith('http') ? imgUrl : makeAbsoluteUrl(imgUrl, baseUrl)))
        .filter(Boolean);

    logger.debug(`Extracted absolute image URLs: ${absoluteUrls}`);
    return [...new Set(absoluteUrls)];
};

/**
 * Main Scraping Function
 */
const scrapeKyotoKanze = async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Set viewport and user-agent for realism
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );

    logger.info('Navigating to the main page...');
    try {
        await page.goto('http://kyoto-kanze.jp/show_info/', {
            waitUntil: 'networkidle2',
            timeout: 60000,
        });
    } catch (error) {
        logger.error(`Failed to navigate to main page: ${error.message}`);
        await browser.close();
        return [];
    }

    // Wait for the main content to load
    try {
        await page.waitForSelector('.jump_m50', { timeout: 30000 });
    } catch (error) {
        logger.warn('Timeout waiting for .jump_m50 selector.');
    }

    await delay(3000); // Additional wait to ensure full rendering

    logger.info('Main page loaded.');

    const eventData = [];
    const visitedLinks = new Set();

    // Define Venue Information (assuming all events are at the same venue)
    const venueData = {
        name: '観世会館',
        address: '京都府京都市左京区四条通下鴨東入ル末社町７８',
        city: '京都市',
        postal_code: '606-8501',
        country: 'Japan'
    };

    // Generate or retrieve a venue_id (for simplicity, use a hash of the venue name)
    const venue_id = generateHash(venueData.name);

    // Initialize a queue to handle concurrency
    const queue = new PQueue({ concurrency: 5 }); // Adjust concurrency as needed

    // Select all monthly sections
    const jumpSections = await page.$$('.jump_m50');

    logger.info(`Found ${jumpSections.length} monthly sections.`);

    if (jumpSections.length === 0) {
        logger.warn('No monthly sections found. Please check the selectors or the website structure.');
    }

    for (const section of jumpSections) {
        // Extract base year and month from the section's ID or other attributes
        const sectionId = await section.evaluate((el) => el.id).catch(() => '');
        let year = '';
        let month = '';
        const match = sectionId.match(/(\d{4})(\d{2})/);
        if (match) {
            year = match[1];
            month = match[2];
            logger.info(`Processing events for ${year}-${month}`);
        } else {
            logger.warn(`Unable to extract year and month from section ID: ${sectionId}`);
            continue;
        }

        // Select all events within the current monthly section
        const eventDivs = await section.$$('.link');
        logger.info(`Found ${eventDivs.length} events in section ${year}-${month}.`);

        for (const [index, eventDiv] of eventDivs.entries()) {
            // Enqueue each event processing to handle concurrency
            queue.add(async () => {
                try {
                    const innerHTML = await eventDiv.evaluate((el) => el.innerHTML);
                    const isFreeEvent = innerHTML.includes('無料公演') || innerHTML.includes('無料');

                    // Extract event link from <a href="...">
                    const eventLink = await eventDiv.$eval('a', (a) => a.href).catch(() => null);
                    logger.debug(`Extracted event link: ${eventLink}`);

                    // Extract event title from <p class="bl_title">
                    let rawTitle = await eventDiv.$eval('.bl_title', (el) => el.textContent.trim()).catch(() => 'Unnamed Event');
                    logger.debug(`Extracted raw title: ${rawTitle}`);

                    // Normalize the title
                    const title = normalizeTitle(rawTitle);
                    logger.debug(`Normalized title: ${title}`);

                    // Extract date and time string, then convert to half-width
                    let dateAndTime = toHalfWidth(rawTitle);
                    logger.debug(`Converted date and time string: ${dateAndTime}`);

                    // Parse date and time
                    const parsedDateTime = parseJapaneseDateTime(dateAndTime);

                    if (!parsedDateTime) {
                        logger.error(`Date not found or does not match expected format in dateAndTime: "${dateAndTime}"`);
                        return; // Skip this event
                    }

                    const { date_start, date_end, time_start, time_end } = parsedDateTime;
                    logger.debug(`Parsed Date and Time: Start - ${date_start}, End - ${date_end}, Start Time - ${time_start}, End Time - ${time_end}`);

                    // Extract organizer information
                    let organizer = await eventDiv.$$eval('.box p', (ps) => {
                        for (const p of ps) {
                            if (p.textContent.includes('主催：')) {
                                return p.textContent.replace('主催：', '').trim();
                            }
                        }
                        return 'Unknown Organizer';
                    }).catch(() => 'Unknown Organizer');
                    logger.debug(`Extracted organizer: ${organizer}`);

                    // Extract description (if available)
                    let description = await eventDiv.$$eval('.box p', (ps) => {
                        let desc = '';
                        ps.forEach(p => {
                            if (!p.textContent.includes('主催：') && !p.textContent.includes('入場料：')) {
                                desc += p.textContent.trim() + '\n';
                            }
                        });
                        return desc.trim();
                    }).catch(() => 'No description available');
                    logger.debug(`Extracted description: ${description}`);

                    // Extract price information
                    let priceText = await eventDiv.$$eval('.box', (boxes) => {
                        let text = '';
                        boxes.forEach(box => {
                            if (box.textContent.includes('入場料：') || box.textContent.includes('￥')) {
                                text += box.textContent.trim() + '\n';
                            }
                        });
                        return text;
                    }).catch(() => '');
                    logger.debug(`Extracted price text: ${priceText}`);

                    // If priceText is empty, attempt to extract from comments
                    if (!priceText) {
                        priceText = extractTextFromComments(innerHTML);
                        logger.debug(`Extracted price text from comments: ${priceText}`);
                    }

                    const prices = parsePrices(priceText);
                    logger.debug(`Parsed prices: ${JSON.stringify(prices)}`);

                    // Extract image URL
                    let imageUrl = '/images/events/kyoto_kanze/placeholder.jpg'; // Default placeholder

                    if (eventLink && !visitedLinks.has(eventLink)) {
                        visitedLinks.add(eventLink);
                        logger.info(`Processing event detail page: ${eventLink}`);

                        const detailPage = await browser.newPage();
                        try {
                            await detailPage.goto(eventLink, {
                                waitUntil: 'domcontentloaded',
                                timeout: 60000,
                            });
                            logger.debug(`Navigated to detail page: ${eventLink}`);
                        } catch (error) {
                            logger.error(`Failed to navigate to detail page: ${eventLink} - ${error.message}`);
                            await detailPage.close();
                            return;
                        }

                        await delay(3000); // Wait for the page to load

                        try {
                            // Extract high-res image URLs
                            const highResImageUrls = await extractHighResImages(detailPage, eventLink);
                            logger.debug(`High-res image URLs extracted: ${highResImageUrls}`);

                            if (highResImageUrls && highResImageUrls.length > 0) {
                                const downloadedImageUrl = await downloadAndSaveImage(highResImageUrls[0], 'kyoto_kanze');
                                if (downloadedImageUrl) {
                                    imageUrl = downloadedImageUrl;
                                }
                                logger.debug(`Downloaded image URL: ${imageUrl}`);
                            }
                             else {
                                logger.warn(`No high-res images found for event: ${eventLink}. Using placeholder.`);
                            }

                            // Optionally, extract more details like description from detail page
                            // Example:
                            // const detailedDescription = await detailPage.$eval('#contentBase .enmoku_text', el => el.innerHTML).catch(() => '');
                            // description = detailedDescription || description;

                        } catch (error) {
                            logger.error(`Error extracting content from ${eventLink}: ${error.message}`);
                        } finally {
                            await detailPage.close();
                            await delay(1000); // Small delay before continuing
                        }
                    } else if (!eventLink) {
                        logger.warn(`No event link found for event: ${title} on ${date_start}`);
                    }

                    // Generate external_id using SHA256 hash of event link or title + date
                    const external_id = eventLink ? generateHash(eventLink) : generateHash(`${title}-${date_start}`);
                    logger.debug(`Generated external_id: ${external_id}`);

                    // Assign image_url to placeholder if no image was found
                    if (!imageUrl) {
                        imageUrl = '/images/events/kyoto_kanze/placeholder.jpg';
                        logger.debug(`No image found. Assigned placeholder image.`);
                    }

                    // Create event data entry
                    const eventDataEntry = {
                        title,
                        organization: organizer,
                        description,
                        date_start,
                        date_end,
                        time_start,
                        time_end,
                        venue_id,
                        address: venueData.address, // Assuming all events share the same venue address
                        external_id,
                        name: venueData.name,
                        address: venueData.address,
                        city: venueData.city,
                        postal_code: venueData.postal_code,
                        country: venueData.country,
                        schedule: [
                            {
                                date: date_start,
                                time_start,
                                time_end,
                                special_notes: null,
                                status: 'upcoming' // Adjust based on current date if necessary
                            }
                        ],
                        prices,
                        host: organizer,
                        event_link: eventLink || null,
                        image_url: imageUrl,
                        alt_text: `${title} Image`,
                        is_featured: true,
                        categories: isFreeEvent ? ['Free Event'] : ['Paid Event'],
                        tags: isFreeEvent ? ['Free'] : ['Professional', 'Paid'],
                        status: 'upcoming', // Adjust based on current date if necessary
                        free: isFreeEvent,
                        site: 'kyoto_kanze',
                    };

                    logger.debug(`Assigned image URL to event "${title}": ${imageUrl}`);


                    // Check for duplicate based on external_id
                    if (!eventData.some((event) => event.external_id === external_id)) {
                        eventData.push(eventDataEntry);
                        logger.info(`Added event: ${title} on ${date_start}`);
                    } else {
                        logger.warn(`Duplicate event detected: ${title} on ${date_start}`);
                    }

                } catch (error) {
                    logger.error(`Error processing event: ${error.message}`);
                }
            });
        }
    }

    // Wait for all queued tasks to complete
    await queue.onIdle();

    await browser.close();

    if (eventData.length === 0) {
        logger.warn('No data scraped for site: kyoto_kanze');
    } else {
        logger.info(`Scraped ${eventData.length} events for site: kyoto_kanze`);
    }

    return eventData;
};

// Execute the scraper if the script is run directly
if (process.argv[1] === path.join(__dirname, 'scrapeKyotoKanze.js')) {
    (async () => {
        logger.info('Starting scraping process for Kyoto Kanze...');
        try {
            const data = await scrapeKyotoKanze();
            if (data.length === 0) {
                logger.warn('No data scraped for site: kyoto_kanze');
            } else {
                // Save the data to a JSON file
                const outputPath = path.join(__dirname, 'kyoto_kanze_events.json');
                await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
                logger.info(`Data saved to ${outputPath}`);
            }
        } catch (error) {
            logger.error(`Error during scraping: ${error.message}`);
        }
        logger.info('Scraping process completed.');
    })();
}

export default scrapeKyotoKanze;
