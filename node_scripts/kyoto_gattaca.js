// scraper_kyoto_gattaca.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp'; // For image validation
import pLimit from 'p-limit'; // For concurrency control

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the stealth plugin to evade detection
puppeteer.use(StealthPlugin());

// Helper function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Utility function to generate a SHA256 hash of a given string.
 * Strips query parameters and fragments to ensure consistency.
 * @param {string} url - The input URL to hash.
 * @returns {string} - The resulting SHA256 hash in hexadecimal format.
 */
const generateHash = (url) => {
  try {
    const urlObj = new URL(url);
    const hashInput = `${urlObj.origin}${urlObj.pathname}`; // Exclude query params and fragments
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  } catch (error) {
    console.error(`Invalid URL provided for hashing: ${url}`);
    // Fallback to hashing the entire URL if parsing fails
    return crypto.createHash('sha256').update(url).digest('hex');
  }
};

/**
 * Downloads an image from the given URL and saves it locally.
 * Ensures that images are saved with unique filenames based on their URL hashes.
 * Prevents duplicate downloads by checking existing files.
 * 
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'kyoto_gattaca').
 * @param {string} imagesDir - The directory where images are saved.
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, imagesDir, retries = 3) => {
  try {
    if (!imageUrl || imageUrl === 'No image available') {
      console.warn('No valid image URL provided. Using placeholder.');
      return '/images/events/placeholder.jpg'; // Ensure this placeholder exists
    }

    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://kyoto-gattaca.jp${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

    console.log(`Downloading image: ${absoluteImageUrl}`);

    // Generate a unique filename using SHA256 hash of the image URL (excluding query params and fragments)
    const imageHash = generateHash(absoluteImageUrl);
    let extension = path.extname(new URL(absoluteImageUrl).pathname).split('?')[0] || '.jpg'; // Handle URLs with query params

    // If extension is not valid, attempt to get it from Content-Type
    if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(extension.toLowerCase())) {
      try {
        const headResponse = await axios.head(absoluteImageUrl, { timeout: 5000 });
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
        console.warn(`Failed to retrieve headers for ${absoluteImageUrl}. Using default extension.`);
        extension = '.jpg'; // Default extension
      }
    }

    const filename = `${imageHash}${extension}`;
    const filepath = path.join(imagesDir, filename);

    // Check if the image file already exists
    if (fs.existsSync(filepath)) {
      console.log(`Image already exists locally: ${filename}`);
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
        console.error(`Error writing image to ${filepath}:`, err.message);
        reject(err);
      });
    });

    console.log(`Image downloaded and saved to: ${filepath}`);

    // Validate the downloaded image
    const isValid = await validateImage(filepath);
    if (!isValid) {
      fs.unlinkSync(filepath); // Remove corrupted image
      console.warn(`Corrupted image removed: ${filepath}. Using placeholder.`);
      return '/images/events/placeholder.jpg';
    }

    // Return the relative URL to the image
    return `/images/events/${site}/${filename}`;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Retrying download for image: ${imageUrl}. Attempts left: ${retries}`);
      await delay(1000); // Wait before retrying
      return downloadImage(imageUrl, site, imagesDir, retries - 1);
    }
    console.error(`Failed to download image after retries: ${imageUrl}. Error: ${error.message}`);
    // Return path to a placeholder image
    return '/images/events/placeholder.jpg'; // Ensure this placeholder exists
  }
};

/**
 * Validates that the file at the given path is a valid image.
 * @param {string} filepath - The path to the image file.
 * @returns {Promise<boolean>} - Returns true if valid, false otherwise.
 */
const validateImage = async (filepath) => {
  try {
    await sharp(filepath).metadata();
    return true;
  } catch (error) {
    console.error(`Image validation failed for ${filepath}:`, error.message);
    return false;
  }
};

/**
 * Parses the date from the event date text.
 * 
 * @param {string} dateText - The raw date text extracted from the page.
 * @param {string} pageUrl - The URL of the current page to extract the year.
 * @returns {string|null} - The formatted date in 'YYYY-MM-DD' format or null if parsing fails.
 */
const parseDate = (dateText, pageUrl) => {
  const dateMatch = dateText.match(/(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    const month = dateMatch[1].toString().padStart(2, '0');
    const day = dateMatch[2].toString().padStart(2, '0');
    const yearMatch = pageUrl.match(/\/(\d{4})\/(\d{1,2})\.html/);
    let year = new Date().getFullYear();
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
    }
    return `${year}-${month}-${day}`;
  }
  return null;
};

/**
 * Parses the price data from the price text.
 * 
 * @param {string} priceText - The raw price text extracted from the page.
 * @returns {Array} - An array of price objects.
 */
const parsePriceData = (priceText) => {
  const prices = [];
  // Adjusted regex to capture price tier (optional) and amount
  const priceRegex = /(?:\b(ADV|DOOR|STUDENT|TICKET|General)?\b)?\s*￥?([\d,]+)/gi;
  let match;

  while ((match = priceRegex.exec(priceText)) !== null) {
    let price_tier = match[1] ? match[1].toUpperCase() : 'General';
    let amount = match[2];
    prices.push({
      price_tier: price_tier,
      amount: parseInt(amount.replace(/,/g, ''), 10),
      currency: 'JPY',
      discount_info: null, // Can be enhanced to extract discount info if available
    });
  }
  return prices;
};

/**
 * Assigns categories based on keywords in the title and description.
 * @param {string} title - The event title.
 * @param {string} description - The event description.
 * @returns {Array} - An array of categories.
 */
const assignCategories = (title, description) => {
  const categories = [];
  const categoryKeywords = {
    Music: ['music', 'concert', 'live'],
    Theatre: ['theatre', 'drama', 'play'],
    Dance: ['dance', 'ballet', 'b-boy'],
    Art: ['art', 'exhibition', 'gallery'],
    Workshop: ['workshop', 'seminar', 'class'],
    Festival: ['festival', 'fete', 'celebration'],
    Family: ['family', 'kids', 'children'],
    Wellness: ['wellness', 'yoga', 'meditation'],
    Sports: ['sports', 'marathon', 'competition'],
  };

  Object.keys(categoryKeywords).forEach((category) => {
    const keywords = categoryKeywords[category];
    const regex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
    if (regex.test(title) || regex.test(description)) {
      categories.push(category);
    }
  });

  return categories;
};

/**
 * Assigns tags based on keywords in the title and description.
 * @param {string} title - The event title.
 * @param {string} description - The event description.
 * @returns {Array} - An array of tags.
 */
const assignTags = (title, description) => {
  const tags = [];
  const tagKeywords = {
    'Classical Music': ['classical', 'symphony', 'opera'],
    'Jazz': ['jazz'],
    'Rock': ['rock', 'metal', 'alternative'],
    'Ballet': ['ballet'],
    'Modern Dance': ['modern dance', 'contemporary'],
    'Drama': ['drama', 'play'],
    'Comedy': ['comedy', 'stand-up'],
    'Art Exhibition': ['exhibition', 'gallery'],
    'Photography': ['photography'],
    'Workshop': ['workshop', 'seminar'],
    // Add more tags as needed
  };

  Object.keys(tagKeywords).forEach((tag) => {
    const keywords = tagKeywords[tag];
    const regex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
    if (regex.test(title) || regex.test(description)) {
      tags.push(tag);
    }
  });

  return tags;
};

/**
 * Validates that the file at the given path is a valid image.
 * @param {string} filepath - The path to the image file.
 * @returns {Promise<boolean>} - Returns true if valid, false otherwise.
 */


/**
 * Main function to scrape Kyoto Gattaca event data.
 * Downloads images, prevents duplicates, and saves event data.
 * 
 * @returns {Promise<Array>} - An array of event objects with updated local image URLs.
 */
const scrapeKyotoGattaca = async () => {
  // Define the site identifier for image storage
  const siteIdentifier = 'kyoto_gattaca';

  // Define the directory where images will be saved
  // Navigate one level up from 'node_scripts' to 'kyoture'
  const imagesDir = path.join(__dirname, '..', 'public', 'images', 'events', siteIdentifier);

  // Create the directory if it doesn't exist
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log(`Created directory: ${imagesDir}`);
  } else {
    console.log(`Directory already exists: ${imagesDir}`);
  }

  // Initialize concurrency limiter
  const limit = pLimit(5); // Limit to 5 concurrent downloads

  // Launch Puppeteer with necessary options
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  // Set a realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  try {
    console.log('Starting to scrape Kyoto Gattaca Schedule pages...');
    const eventsData = [];
    let currentPageUrl = 'http://kyoto-gattaca.jp/schedule/2024/11.html'; // Starting page
    const visitedUrls = new Set();

    while (currentPageUrl && !visitedUrls.has(currentPageUrl)) {
      console.log(`Navigating to ${currentPageUrl}`);
      await page.goto(currentPageUrl, { waitUntil: 'networkidle0', timeout: 60000 }); // 60 seconds timeout

      // Wait for the page content to load
      await delay(2000); // Wait for 2 seconds

      visitedUrls.add(currentPageUrl);

      console.log('On the Schedule page.');

      const hasEvents = (await page.$('h2.month_date')) !== null;
      if (!hasEvents) {
        console.log('No events found on this page. Stopping pagination.');
        break;
      }

      // Select all event elements
      const eventElements = await page.$$('div.schedule');

      // Collect download promises with concurrency control
      const downloadPromises = eventElements.map(eventElement => limit(async () => {
        try {
          const hasDate = (await eventElement.$('h2.month_date')) !== null;
          if (!hasDate) return;

          const dateText = await eventElement.$eval('h2.month_date', (el) => el.textContent.trim());
          const dateStr = parseDate(dateText, page.url());

          let title = await eventElement.$eval('h3', (el) => el.innerText.trim());
          title = title.replace(/\n+/g, ' ').trim();

          let imageUrl = await eventElement
            .$eval('div.eventbox span.event a img', (el) => el.src)
            .catch(() => null);
          if (!imageUrl) {
            imageUrl = await eventElement
              .$eval('div.eventbox span.event a', (el) => el.href)
              .catch(() => null);
          }

          const bandsText = await eventElement
            .$eval('div.eventboxpro h6 span.bandname', (el) => el.innerText.trim())
            .catch(() => '');

          const priceEventBox = await eventElement.$$('div.eventbox');
          if (priceEventBox.length >= 3) {
            const pElements = await priceEventBox[2].$$('p'); // Target the third 'eventbox' specifically
            let openTime = null;
            let startTime = null;
            let ticketInfoLink = null;
            let description = '';
            let prices = [];
            let foundPrice = false;

            for (let i = 0; i < pElements.length; i++) {
              const text = await pElements[i].evaluate((el) => el.textContent.trim());
              console.log('Extracted paragraph text:', text);

              if (text.includes('OPEN / START')) {
                // Extract times
                const times = text.replace('OPEN / START', '').trim();
                const timesMatch = times.match(/(\d+:\d+)\s*\/\s*(\d+:\d+)/);
                if (timesMatch) {
                  openTime = timesMatch[1];
                  startTime = timesMatch[2];
                } else if (times.toUpperCase().includes('TBA')) {
                  openTime = 'TBA';
                  startTime = 'TBA';
                }
              } else if (text.includes('OPEN')) {
                // Extract open time
                const timeMatch = text.match(/OPEN\s*(\d+:\d+)/);
                if (timeMatch) {
                  openTime = timeMatch[1];
                }
              } else if (text.includes('START')) {
                // Extract start time
                const timeMatch = text.match(/START\s*(\d+:\d+)/);
                if (timeMatch) {
                  startTime = timeMatch[1];
                }
              } else if (
                text.includes('ADV') ||
                text.includes('DOOR') ||
                text.includes('STUDENT') ||
                text.toLowerCase().includes('ticket') ||
                text.includes('￥') ||
                text.includes('¥')
              ) {
                console.log('Detected price-related text:', text);
                const extractedPrices = parsePriceData(text);
                console.log('Prices extracted:', extractedPrices);
                if (extractedPrices.length > 0) {
                  prices = prices.concat(extractedPrices);
                  foundPrice = true;
                }
              } else if (text.includes('無料') || text.includes('入場無料') || text.includes('🆓')) {
                console.log('Detected free event:', text);
                prices.push({
                  price_tier: 'Free',
                  amount: 0,
                  currency: 'JPY',
                  discount_info: null,
                });
                foundPrice = true;
              } else if (text.toLowerCase().includes('ticket info')) {
                // Extract ticket info link
                if (i + 1 < pElements.length) {
                  const linkElement = await pElements[i + 1].$('a.event');
                  if (linkElement) {
                    ticketInfoLink = await linkElement.evaluate((el) => el.href);
                  }
                }
              } else {
                description += text + '\n';
              }
            }

            if (!foundPrice) {
              console.warn(`Price information not found for event: ${title}`);
              // Optionally, set prices to null or leave it empty
              // prices = null;
            }

            // Download the image and get the local URL
            const localImageUrl = imageUrl && imageUrl !== 'No image available'
              ? await downloadImage(imageUrl, siteIdentifier, imagesDir)
              : '/images/events/placeholder.jpg'; // Ensure this placeholder exists

            // Assign categories and tags
            const categories = assignCategories(title, description);
            const tags = assignTags(title, description);

            const eventInfo = {
              title: title,
              date_start: dateStr,
              date_end: dateStr,
              image_url: localImageUrl,
              schedule: [
                {
                  date: dateStr,
                  time_start: openTime,
                  time_end: startTime,
                  special_notes: null,
                },
              ],
              prices: prices.length > 0 ? prices : [],
              venue: 'Kyoto Gattaca',
              organization: 'Kyoto Gattaca',
              description: description.trim(),
              event_link: currentPageUrl,
              categories: categories,
              tags: tags,
              site: siteIdentifier,
            };

            eventsData.push(eventInfo);
            console.log('Extracted event data:', eventInfo);
          } // End of if (priceEventBox.length >= 3)
        } catch (error) {
          console.error('Error extracting event data:', error);
        }
      }));

      // Await all download promises
      await Promise.all(downloadPromises);

      // Handle pagination: find the 'Next' button/link
      const nextLinkHref = await page.evaluate(() => {
        const areaElements = document.querySelectorAll('map[name="Map"] area');
        for (let area of areaElements) {
          if (area.alt && area.alt.toLowerCase() === 'next') {
            return area.getAttribute('href');
          }
        }
        return null;
      });

      if (nextLinkHref) {
        const nextUrl = new URL(nextLinkHref, page.url()).href;
        if (visitedUrls.has(nextUrl)) {
          console.log('Already visited this page, stopping to prevent infinite loop.');
          break;
        } else {
          currentPageUrl = nextUrl;
        }
      } else {
        console.log('No next link found, ending pagination.');
        currentPageUrl = null;
      }
    } // End of while loop

    console.log('Final cleaned event data:', eventsData);
    await browser.close();

    // Save the data to a JSON file for manual inspection
    fs.writeFileSync('kyoto_gattaca_events.json', JSON.stringify(eventsData, null, 2));
    console.log('Data saved to kyoto_gattaca_events.json');

    return eventsData.map((event) => ({ ...event, site: siteIdentifier }));
  } catch (error) {
    console.error('Error during scraping:', error);
    await browser.close();
    return [];
  }
}; // Ensure this closes the function properly

export default scrapeKyotoGattaca;

// If the script is run directly, execute the scraping function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      const data = await scrapeKyotoGattaca();
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('An error occurred:', error);
    }
  })();
}
