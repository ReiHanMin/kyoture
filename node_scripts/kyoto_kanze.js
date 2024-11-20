// scrapeKyotoKanze.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import axios from 'axios';

// Use the stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Utility function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to convert full-width characters to half-width
const toHalfWidth = (str) =>
    str
        .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, ' '); // Convert full-width space to half-width

// Function to normalize event titles by removing known prefixes and trimming whitespace
function normalizeTitle(title) {
    // Remove known prefixes (case-insensitive) if any
    return title
        .replace(/^(Kyoto Kanze|林能楽会|橋本聲吟社|fever)\s*[-：:]\s*/i, '')
        .replace(/<[^>]+>/g, '') // Remove any remaining HTML tags
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .trim();
}

// Function to parse date and time from the Japanese format
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
            // If end time is not provided, you might set a default duration or leave it null
        } else if (dateTimeStr.includes('開演時間未定')) {
            time_start = 'To Be Announced';
        }

        return { date_start, date_end, time_start, time_end };
    }

    return null;
}

// Function to extract text from HTML comments
function extractTextFromComments(html) {
    const commentRegex = /<!--([\s\S]*?)-->/g;
    let match;
    let comments = [];
    while ((match = commentRegex.exec(html)) !== null) {
        comments.push(match[1]);
    }
    return comments.join('\n');
}

// Function to parse price information from text
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
        'ﾃﾞｲﾀｲﾑ･ﾄﾜｲﾗｲﾄ席': 'Timed & Twilite Seat',
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
                amount: amount,
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
                amount: amount,
                currency: 'JPY',
            });

            continue;
        }

        // Handle "無料" mentions
        if (/無料/.test(line)) {
            prices.push({ price_tier: 'Free', amount: '0', currency: 'JPY' });
            continue;
        }

        // If line doesn't match any pattern, log it for further inspection
        console.warn(`Unrecognized price line format: "${line}"`);
    }

    return prices;
}

// Function to make absolute URLs from relative ones
function makeAbsoluteUrl(url, base) {
    try {
        return new URL(url, base).href;
    } catch (e) {
        console.error(`Invalid URL: ${url} with base: ${base}`);
        return null; // Return null to handle invalid URLs
    }
}

// Function to validate image size (in bytes)
async function isImageHighRes(url, minSize = 50000) { // 50KB as a threshold
    try {
        const response = await axios.head(url);
        const size = parseInt(response.headers['content-length'], 10);
        return size >= minSize;
    } catch (error) {
        console.error(`Error fetching image headers for ${url}:`, error);
        return false;
    }
}

// Function to extract all high-resolution image URLs from the detail page
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

    // If high-res images are found, return them
    if (validHighResImages.length > 0) {
        return validHighResImages;
    }

    // Fallback: Assign a default placeholder image
    const defaultPlaceholder = 'http://kyoto-kanze.jp/images/top002.jpg'; // Ensure this exists
    console.warn(`No valid high-res images found. Assigning default placeholder: ${defaultPlaceholder}`);
    return [defaultPlaceholder];
}

// Main scraping function
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

                // Extract event title from <h2>
                let rawTitle = await eventDiv
                    .$eval('h2', (el) => el.textContent.replace(/\n/g, ' ').trim())
                    .catch(() => '');

                // If <h2> is not found or empty, try alternative methods
                if (!rawTitle) {
                    rawTitle = await eventDiv
                        .$eval('.box p', (el) => el.textContent.replace(/\n/g, ' ').trim())
                        .catch(() => 'Unnamed Event');
                }

                // Normalize the title
                const title = rawTitle ? normalizeTitle(rawTitle) : 'Unnamed Event';

                // Determine if the event is "Candlelightコンサート"
                const isCandlelight = title.includes('Candlelightコンサート');

                // Extract date and time string, then convert to half-width
                let dateAndTime = await eventDiv
                    .$eval('.bl_title', (el) => el.textContent.trim())
                    .catch(() => '');
                dateAndTime = toHalfWidth(dateAndTime);

                // Extract host information
                let host = await eventDiv
                    .$eval('.box p:not(.midashi):nth-of-type(1)', (el) =>
                        el.textContent.trim()
                    )
                    .catch(() => '');

                // Fallback: If host is empty, attempt to extract from another element
                if (!host) {
                    host = await eventDiv
                        .$eval('.box p', (el) => el.textContent.trim())
                        .catch(() => 'Unknown Host');
                }

                // Extract price information
                let priceText = '';

                // Attempt to extract visible price information
                const priceElements = await eventDiv.$$eval('.box', (boxes) =>
                    boxes.map((box) => box.textContent.trim())
                );

                // Identify boxes that likely contain price information
                for (const boxText of priceElements) {
                    if (
                        boxText.includes('入場料：') ||
                        boxText.includes('前売券') ||
                        boxText.includes('当日券') ||
                        boxText.includes('学生券') ||
                        boxText.includes('料金') ||
                        boxText.includes('価格') ||
                        boxText.includes('￥')
                    ) {
                        priceText = boxText;
                        break;
                    }
                }

                // If priceText is still empty, attempt to extract from HTML comments
                if (!priceText) {
                    const extractedComments = extractTextFromComments(innerHTML);
                    if (extractedComments.includes('￥')) {
                        priceText = extractedComments;
                    }
                }

                // Parse prices from priceText
                const prices = parsePrices(priceText);

                // Log extracted information for debugging
                console.log(`\n---\nProcessing Event ${index + 1} in ${year}-${month}:\nTitle: ${rawTitle}\nNormalized Title: ${title}\nDate and Time: ${dateAndTime}\nHost: ${host}\nPrice Text: ${priceText}`);
                console.log(`Extracted Prices: ${JSON.stringify(prices)}`);

                // Date Parsing Logic
                const parsedDateTime = parseJapaneseDateTime(dateAndTime);

                let date_start, date_end, time_start = null, time_end = null;

                if (parsedDateTime) {
                    ({ date_start, date_end, time_start, time_end } = parsedDateTime);
                    console.log(`Parsed Date: ${date_start}`);
                    if (time_start) {
                        console.log(`Parsed Time Start: ${time_start}`);
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
                    organization: 'Kyoto Kanze', // Static value; adjust if organization info is available
                    image_url: 'http://kyoto-kanze.jp/images/top002.jpg', // Default image; may be updated below
                    schedule: [
                        {
                            date: date_start,
                            time_start,
                            time_end,
                            special_notes: null,
                        },
                    ],
                    prices,
                    host,
                    event_link: 'http://kyoto-kanze.jp/show_info/', // Placeholder; will update for paid events
                    content_base_html: innerHTML,
                    description: 'No description available', // Placeholder; can be updated if description exists
                    categories: [],
                    tags: [],
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

                // Determine if the event is "Candlelightコンサート"
                if (isCandlelight) {
                    // Assign stock image and skip further image scraping
                    eventDataEntry.image_url = 'http://kyoto-kanze.jp/images/top002.jpg';
                    console.log(`Assigned stock image for Candlelightコンサート: ${title}`);
                    continue; // Skip scraping detail page for this exception
                }

                // Handle paid events by visiting their detail pages
                if (!isFreeEvent && prices.length > 0) {
                    const eventLinks = await eventDiv.$$eval('a', (els) =>
                        els.map((el) => el.href)
                    );
                    const validEventLinks = eventLinks.filter((link) => {
                        if (!link) return false;
                        try {
                            const url = new URL(link);
                            return (
                                url.hostname === 'kyoto-kanze.jp' &&
                                url.pathname.startsWith('/show_info/')
                            );
                        } catch (e) {
                            return false;
                        }
                    });

                    const eventLink =
                        validEventLinks.length > 0
                            ? validEventLinks[0]
                            : null;
                    if (eventLink && !visitedLinks.has(eventLink)) {
                        visitedLinks.add(eventLink);
                        console.log(
                            `Opening detail page for paid event: ${eventLink}`
                        );

                        const detailPage = await browser.newPage();
                        await detailPage.goto(eventLink, {
                            waitUntil: 'domcontentloaded',
                            timeout: 60000,
                        });

                        // Delay to ensure the page has fully loaded
                        await delay(3000); // Wait for 3 seconds

                        try {
                            // Extract detailed content HTML
                            const contentBaseHTML = await detailPage
                                .$eval('#content', (el) => el.innerHTML)
                                .catch(() => '');

                            // Extract detailed image URLs using the new image scraping logic
                            const highResImageUrls = await extractHighResImages(detailPage, eventLink);

                            if (contentBaseHTML) {
                                // Update event entry with detailed information
                                eventDataEntry.event_link = eventLink;
                                eventDataEntry.content_base_html = contentBaseHTML;

                                if (highResImageUrls && highResImageUrls.length > 0) {
                                    // Assign the first high-res image
                                    eventDataEntry.image_url = highResImageUrls[0];
                                    console.log(`Updated image URL from detail page: ${highResImageUrls[0]}`);
                                } else {
                                    console.warn(`No high-res images found for event: ${eventLink}. Assigned default placeholder.`);
                                    // Assign a default image
                                    eventDataEntry.image_url = 'http://kyoto-kanze.jp/images/top002.jpg';
                                }

                                eventDataEntry.free = false;
                                console.log('Extracted paid event data:', eventDataEntry);
                            } else {
                                console.error(`Content not found for event: ${eventLink}`);
                            }
                        } catch (error) {
                            console.error(
                                `Error extracting content from ${eventLink}:`,
                                error
                            );
                        } finally {
                            await detailPage.close();
                            // Optional delay after closing the page
                            await delay(1000); // Wait for 1 second before continuing
                        }
                    } else if (!eventLink) {
                        console.warn(
                            `No valid event link found for paid event: ${title} on ${date_start}`
                        );
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
const __dirnameESM = dirname(__filenameESM);

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
                fs.writeFileSync('kyoto_kanze_events.json', JSON.stringify(data, null, 2), 'utf-8');
                console.log('Data saved to kyoto_kanze_events.json');
            }
        } catch (error) {
            console.error('Error during scraping:', error);
        }
        console.log('All scraping tasks completed.');
    })();
}
