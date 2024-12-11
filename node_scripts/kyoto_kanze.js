// scrapeKyotoKanze.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises'; // Use promises version for async/await
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid'; // For unique filenames

// Configure Puppeteer to use Stealth Plugin
puppeteer.use(StealthPlugin());

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    // Remove known prefixes (case-insensitive) if any
    return title
        .replace(/^(Kyoto Kanze|林能楽会|橋本聲吟社|fever)\s*[-：:]\s*/i, '')
        .replace(/<[^>]+>/g, '') // Remove any remaining HTML tags
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .trim();
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
        return new URL(url, base).href;
    } catch (e) {
        console.error(`Invalid URL: ${url} with base: ${base}`);
        return null; // Return null to handle invalid URLs
    }
}

/**
 * Downloads an image from the given URL and saves it locally.
 * Checks if the image already exists to avoid redundant downloads.
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'kyoto_kanze').
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadAndSaveImage = async (imageUrl, site) => {
    if (!imageUrl) {
        console.warn('No image URL provided. Assigning placeholder.');
        return '/images/events/kyoto_kanze/placeholder.jpg'; // Ensure this exists
    }

    // Define the base URL
    const baseUrl = 'https://kyoto-kanze.jp';
    const absoluteImageUrl = imageUrl.startsWith('http') ? imageUrl : makeAbsoluteUrl(imageUrl, baseUrl);
    if (!absoluteImageUrl) {
        console.warn('Invalid image URL. Assigning placeholder.');
        return '/images/events/kyoto_kanze/placeholder.jpg';
    }

    try {
        const urlObj = new URL(absoluteImageUrl);
        const imagePath = urlObj.pathname; // e.g., '/show_info/20241201show_meeting/images/omote_l.jpg'

        const imagesIndex = imagePath.indexOf('/images/');
        let relativeImagePath = '';

        if (imagesIndex !== -1) {
            relativeImagePath = imagePath.substring(imagesIndex + '/images/'.length); // e.g., 'omote_l.jpg'
        } else {
            relativeImagePath = path.basename(imagePath);
        }

        // Use relativeImagePath as the hash input
        const hash = generateHash(relativeImagePath);
        const extension = path.extname(relativeImagePath) || '.jpg';
        const filename = `${hash}${extension}`;
        const filepath = path.join(__dirname, '..', 'public', 'images', 'events', site, filename);
        const relativeImageUrlLocal = `/images/events/${site}/${filename}`;

        // Check if the image already exists
        try {
            await fs.access(filepath);
            console.log(`Image already exists locally: ${relativeImageUrlLocal}`);
            return relativeImageUrlLocal;
        } catch (err) {
            // File does not exist, proceed to download
            console.log(`Image not found locally. Downloading: ${absoluteImageUrl}`);
        }

        // Download the image
        const response = await axios.get(absoluteImageUrl, { responseType: 'arraybuffer' });

        // Check if the response content type is an image
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
            throw new Error(`Invalid content type: ${contentType}`);
        }

        // Ensure the directory exists
        await fs.mkdir(path.dirname(filepath), { recursive: true });

        // Save the image file
        await fs.writeFile(filepath, response.data);
        console.log(`Image successfully saved: ${relativeImageUrlLocal}`);

        return relativeImageUrlLocal;
    } catch (error) {
        console.error(`Failed to download image from ${absoluteImageUrl}:`, error.message);
        return '/images/events/kyoto_kanze/placeholder.jpg'; // Assign placeholder on failure
    }
};

/**
 * Parse date and time from the Japanese format
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
        const year = new Date().getFullYear(); // Assuming current year; adjust if necessary

        let date_start = `${year}-${month}-${day}`;
        let date_end = date_start;
        let time_start = null;
        let time_end = null;

        if (match[3] && match[4]) {
            time_start = `${match[3].padStart(2, '0')}:${match[4]}`;
            // Assuming a 2-hour duration; adjust as needed
            const endHour = (parseInt(match[3], 10) + 2) % 24;
            time_end = `${endHour.toString().padStart(2, '0')}:${match[4]}`;
        } else if (dateTimeStr.includes('開演時間未定')) {
            time_start = 'To Be Announced';
        }

        return { date_start, date_end, time_start, time_end };
    }

    return null;
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
        '一般前売指定席券': 'General Advance Reserved Seat',
        '一般前売自由席券': 'General Advance Free Seat',
        '一般当日券': 'General Day Ticket',
        '学生券': 'Student Ticket',
        'S席': 'S Seat',
        'A席': 'A Seat',
        '１階席': 'First Floor Seat',
        '２階席': 'Second Floor Seat',
        'ﾃﾞｲﾀｲﾑ･ﾄﾜｲﾗｲﾄ席': 'Timed & Twilight Seat',
        '金': 'Friday',
        '回数券５枚綴': 'Multi-Use Ticket (5-Pack)',
        '特別会員会員券10枚': 'Special Member Ticket (10-Pack)',
        '普通会員会員券10枚': 'Regular Member Ticket (10-Pack)',
        // Add more mappings as necessary
    };

    let lastPriceTier = null;

    // Regex to match lines with both label and amount
    const labeledPriceRegex = /^([^\s￥]+)\s*￥([\d,]+)/;

    // Regex to match lines with only amount
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
                amount: parseInt(amount, 10),
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
                amount: parseInt(amount, 10),
                currency: 'JPY',
            });

            continue;
        }

        // Handle "無料" mentions
        if (/無料/.test(line)) {
            prices.push({ price_tier: 'Free', amount: 0, currency: 'JPY' });
            continue;
        }

        // If line doesn't match any pattern, log it for further inspection
        console.warn(`Unrecognized price line format: "${line}"`);
    }

    return prices;
}

/**
 * Extract high-resolution image URLs from the detail page and download them
 * @param {object} detailPage 
 * @param {string} baseUrl 
 * @returns {Promise<string>} - Returns the local image URL
 */
async function extractHighResImages(detailPage, baseUrl) {
    // Initialize an array to hold high-res image URLs
    let highResImageUrls = [];

    // 1. Extract from <a> tags linking to high-res images
    const aTagsHighRes = await detailPage.$$eval(
        'a[href*="_l.jpg"], a[href*="_l.png"], a[href*="_l.gif"], a[href*="_highres.jpg"], a[href*="_highres.png"], a[href*="omote_l.jpg"], a[href*="ura_l.jpg"]',
        (as) => as.map((a) => a.href)
    ).catch(() => []);

    console.log(`Found ${aTagsHighRes.length} high-res images within <a> tags.`);

    // 2. Extract from <img> tags directly referencing high-res images
    const imgTagsHighRes = await detailPage.$$eval(
        'img[src*="_l.jpg"], img[src*="_l.png"], img[src*="_l.gif"], img[src*="_highres.jpg"], img[src*="_highres.png"], img[src*="omote_l.jpg"], img[src*="ura_l.jpg"]',
        (imgs) => imgs.map((img) => img.src)
    ).catch(() => []);

    console.log(`Found ${imgTagsHighRes.length} high-res images within <img> tags.`);

    // 3. Additional Patterns: Look for any image with 'highres' in the class or data attributes
    const additionalHighRes = await detailPage.$$eval(
        'img[class*="highres"], img[data-src*="highres"], img[data-original*="highres"]',
        (imgs) => imgs.map((img) => img.src || img.dataset.src || img.dataset.original)
    ).catch(() => []);

    console.log(`Found ${additionalHighRes.length} high-res images within additional patterns.`);

    // 4. Handle Images with Relative Paths
    const relativeImages = await detailPage.$$eval(
        'a[href*="_l.jpg"], a[href*="_l.png"], a[href*="_l.gif"], a[href*="_highres.jpg"], a[href*="_highres.png"], a[href*="omote_l.jpg"], a[href*="ura_l.jpg"], img[src*="_l.jpg"], img[src*="_l.png"], img[src*="_l.gif"], img[src*="_highres.jpg"], img[src*="_highres.png"], img[src*="omote_l.jpg"], img[src*="ura_l.jpg"]',
        (elements) =>
            elements
                .map((el) => el.href || el.src)
                .filter((url) => url && !url.startsWith('http'))
    ).catch(() => []);

    console.log(`Found ${relativeImages.length} relative high-res image URLs.`);

    // Convert relative URLs to absolute URLs
    const absoluteHighResImageUrls = aTagsHighRes.concat(imgTagsHighRes, additionalHighRes).map((href) =>
        href.startsWith('http') ? href : makeAbsoluteUrl(href, baseUrl)
    ).filter(url => url !== null);

    // Include relative image URLs converted to absolute
    absoluteHighResImageUrls.push(...relativeImages.map((href) => makeAbsoluteUrl(href, baseUrl)).filter(url => url !== null));

    // Remove duplicates
    highResImageUrls = [...new Set(absoluteHighResImageUrls)];

    console.log(`Total high-res image URLs found: ${highResImageUrls.length}`);

    // Filter out any images ending with 'thumb01.jpg' or main page defaults
    const filteredHighResImageUrls = highResImageUrls.filter(
        (url) =>
            !url.toLowerCase().endsWith('thumb01.jpg') &&
            !url.toLowerCase().endsWith('top002.jpg') &&
            !url.toLowerCase().includes('default_placeholder')
    );

    console.log(`Filtered High-Res Image URLs (excluding 'thumb01.jpg' and defaults): ${filteredHighResImageUrls.join(', ')}`);

    // Validate image sizes to ensure they're truly high-res
    const validHighResImages = [];
    for (const url of filteredHighResImageUrls) {
        const highRes = await isImageHighRes(url);
        if (highRes) {
            validHighResImages.push(url);
        }
    }

    console.log(`Valid high-res images after size check: ${validHighResImages.length}`);

    // Download the first valid high-res image
    if (validHighResImages.length > 0) {
        const downloadedImageUrl = await downloadAndSaveImage(validHighResImages[0], 'kyoto_kanze');
        return downloadedImageUrl;
    }

    // Fallback: Assign a default placeholder image
    const defaultPlaceholder = '/images/events/kyoto_kanze/placeholder.jpg'; // Ensure this exists in your public directory
    console.warn(`No valid high-res images found. Assigning default placeholder: ${defaultPlaceholder}`);
    return defaultPlaceholder;
}

/**
 * Validate image size (in bytes)
 * @param {string} url 
 * @param {number} minSize - Minimum size in bytes (default: 50KB)
 * @returns {boolean}
 */
async function isImageHighRes(url, minSize = 50000) { // 50KB as a threshold
    try {
        const response = await axios.head(url);
        const size = parseInt(response.headers['content-length'], 10);
        return size >= minSize;
    } catch (error) {
        console.error(`Error fetching image headers for ${url}:`, error.message);
        return false;
    }
}

/**
 * Main scraping function
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

    console.log('Navigating to the main page...');
    await page.goto('http://kyoto-kanze.jp/show_info/', {
        waitUntil: 'networkidle2',
        timeout: 60000,
    });

    // Wait for the main content to load
    await page.waitForSelector('.jump_m50', { timeout: 30000 }).catch(() => {
        console.warn('Timeout waiting for .jump_m50 selector.');
    });

    await delay(3000); // Additional wait to ensure full rendering

    console.log('Main page loaded.');

    const eventData = [];
    const visitedLinks = new Set();

    // Select all monthly sections
    const jumpSections = await page.$$('.jump_m50');

    console.log(`Found ${jumpSections.length} monthly sections.`);

    if (jumpSections.length === 0) {
        console.warn('No monthly sections found. Please check the selectors or the website structure.');
    }

    for (const section of jumpSections) {
        // Extract base year and month from the title
        const yearMonthText = await section
            .$eval('.title .kouen_month', (el) => el.textContent.trim())
            .catch(() => '');

        if (!yearMonthText) {
            console.warn('Year and month text not found in a section. Skipping this section.');
            continue;
        }

        let year = '';
        let month = '';
        const match = yearMonthText.match(/(\d{4})年\s*?(\d{1,2})月/);
        if (match) {
            year = match[1]; // e.g., '2024'
            month = match[2].padStart(2, '0'); // e.g., '11'
            console.log(`Processing events for ${year}-${month}`);
        } else {
            console.warn('Year and month not found in text:', yearMonthText);
            continue;
        }

        // Select all events within the current monthly section
        const eventDivs = await section.$$('.link');
        console.log(`Found ${eventDivs.length} events in section ${year}-${month}.`);

        for (const [index, eventDiv] of eventDivs.entries()) {
            try {
                const innerHTML = await eventDiv.evaluate((el) => el.innerHTML);
                const isFreeEvent = innerHTML.includes('<!-- 無料公演 -->') || innerHTML.includes('無料');

                // Extract event title from <p class="bl_title">
                let rawTitle = await eventDiv
                    .$eval('.bl_title', (el) => el.textContent.replace(/\n/g, ' ').trim())
                    .catch(() => '');
                // Normalize the title
                const title = rawTitle ? normalizeTitle(rawTitle) : 'Unnamed Event';

                // Extract date and time string, then convert to half-width
                let dateAndTime = rawTitle ? toHalfWidth(rawTitle) : '';
                console.log(`\n---\nProcessing Event ${index + 1} in ${year}-${month}:\nTitle: ${rawTitle}\nNormalized Title: ${title}\nDate and Time: ${dateAndTime}`);

                // Extract organizer information from <p> containing '主催：'
                let organizer = await eventDiv.$$eval('.box p', (ps) => {
                    for (const p of ps) {
                        if (p.textContent.includes('主催：')) {
                            return p.textContent.replace('主催：', '').trim();
                        }
                    }
                    return 'Unknown Organizer';
                }).catch(() => 'Unknown Organizer');
                console.log(`Organizer: ${organizer}`);

                // Extract price information
                let priceText = '';
                const priceBoxes = await eventDiv.$$('.box');
                for (const box of priceBoxes) {
                    const boxText = await box.evaluate((el) => el.textContent.trim());
                    if (boxText.includes('入場料：') || boxText.includes('￥')) {
                        priceText += boxText + '\n';
                    }
                }

                // If priceText is empty, attempt to extract from HTML comments
                if (!priceText) {
                    priceText = extractTextFromComments(innerHTML);
                    console.log(`Price Text from Comments: ${priceText}`);
                }

                // Parse prices from priceText
                const prices = parsePrices(priceText);
                console.log(`Parsed Prices: ${JSON.stringify(prices)}`);

                // Date Parsing Logic
                const parsedDateTime = parseJapaneseDateTime(dateAndTime);

                let date_start, date_end, time_start = null, time_end = null;

                if (parsedDateTime) {
                    ({ date_start, date_end, time_start, time_end } = parsedDateTime);
                    console.log(`Parsed Date: ${date_start}`);
                    if (time_start) {
                        console.log(`Parsed Time Start: ${time_start}`);
                        console.log(`Parsed Time End: ${time_end}`);
                    } else {
                        console.log(`No time information found for event on ${date_start}`);
                    }
                } else {
                    console.error('Date not found or does not match expected format in dateAndTime:', dateAndTime);
                    // Optionally, skip this event or assign a default date
                    continue;
                }

                // Initialize event data entry
                const eventDataEntry = {
                    title,
                    date_start,
                    date_end,
                    venue: 'Kyoto Kanze', // Static value; adjust if venue info is available
                    organization: organizer, // Correctly assigning organizer
                    image_url: '/images/events/kyoto_kanze/placeholder.jpg', // Default image; will update below
                    schedule: [
                        {
                            date: date_start,
                            time_start,
                            time_end,
                            special_notes: null,
                        },
                    ],
                    prices,
                    host: organizer,
                    event_link: 'http://kyoto-kanze.jp/show_info/', // Placeholder; will update for paid events
                    content_base_html: innerHTML,
                    description: 'No description available', // Placeholder; can be updated if description exists
                    categories: isFreeEvent ? ['Free Event'] : ['Paid Event'],
                    tags: isFreeEvent ? ['Free'] : ['Professional', 'Paid'],
                    ended: false,
                    free: isFreeEvent,
                    site: 'kyoto_kanze',
                };

                // Check for duplicate based on normalized title and date
                if (
                    !eventData.some(
                        (event) =>
                            event.title === title &&
                            event.date_start === date_start
                    )
                ) {
                    eventData.push(eventDataEntry);
                    console.log(`Added event: ${title} on ${date_start}`);
                } else {
                    console.log(
                        `Duplicate event detected: ${title} on ${date_start}`
                    );
                }

                // Handle paid events by visiting their detail pages
                if (!isFreeEvent && prices.length > 0) {
                    // Extract event link from <a href="...">
                    const eventLinks = await eventDiv.$$eval('a', (as) => as.map((a) => a.href).filter(href => href && href.includes('/show_info/')));
                    const eventLink = eventLinks.length > 0 ? eventLinks[0] : null;
                    console.log(`Extracted Event Link: ${eventLink}`);

                    if (eventLink && !visitedLinks.has(eventLink)) {
                        visitedLinks.add(eventLink);
                        console.log(`Opening detail page for paid event: ${eventLink}`);

                        const detailPage = await browser.newPage();
                        await detailPage.goto(eventLink, {
                            waitUntil: 'domcontentloaded',
                            timeout: 60000,
                        });

                        // Delay to ensure the page has fully loaded
                        await delay(3000); // Wait for 3 seconds

                        try {
                            // Extract high-res image URL and download it
                            const highResImageUrl = await extractHighResImages(detailPage, eventLink);
                            console.log(`High-Res Image URL: ${highResImageUrl}`);

                            // Update the event entry with the downloaded image URL
                            eventDataEntry.image_url = highResImageUrl;

                            // Optionally, extract detailed description
                            const detailedDescription = await detailPage.$eval('.enmoku_text', (el) => el.textContent.trim()).catch(() => 'No detailed description available');
                            eventDataEntry.description = detailedDescription;

                            eventDataEntry.event_link = eventLink;

                            console.log(`Updated Event Entry with Detail Page Data for: ${title}`);
                        } catch (error) {
                            console.error(`Error extracting content from ${eventLink}:`, error.message);
                        } finally {
                            await detailPage.close();
                            // Optional delay after closing the page
                            await delay(1000); // Wait for 1 second before continuing
                        }
                    } else if (!eventLink) {
                        console.warn(`No valid event link found for paid event: ${title} on ${date_start}`);
                        // Optionally, mark the event as incomplete or skip additional processing
                    }
                }
            } catch (error) {
                console.error('Error processing event:', error);
            }
        }
    }

    await browser.close();

    if (eventData.length === 0) {
        console.warn('No data scraped for site: kyoto_kanze');
    } else {
        console.log(`Scraped ${eventData.length} events for site: kyoto_kanze`);
    }

    return eventData.map((event) => ({ ...event, site: 'kyoto_kanze' }));
};

export default scrapeKyotoKanze;

// Defining __filename and __dirname for ES Modules
const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = path.dirname(__filenameESM);

// Check if the current module is the main module
if (process.argv[1] === __filenameESM) {
    (async () => {
        console.log('Running real scraping...');
        console.log('Scraping site: kyoto_kanze');
        try {
            const data = await scrapeKyotoKanze();
            if (data.length === 0) {
                console.log('No data scraped for site: kyoto_kanze');
            } else {
                console.log('Scraped Data:', data);
                // Optionally, save the data to a JSON file
                await fs.writeFile(path.join(__dirname, 'kyoto_kanze_events.json'), JSON.stringify(data, null, 2), 'utf-8');
                console.log('Data saved to kyoto_kanze_events.json');
            }
        } catch (error) {
            console.error('Error during scraping:', error);
        }
        console.log('All scraping tasks completed.');
    })();
}
