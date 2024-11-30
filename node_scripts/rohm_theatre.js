// rohm_theatre.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Environment Variables (Optional)
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// Helper function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to parse dates in the "YYYY.MM.DD – MM.DD" format
const parseDateRange = (dateText) => {
  const match = dateText.match(/^(\d{4}\.\d{1,2}\.\d{1,2}) \([A-Z]+\)(?: – (\d{1,2}\.\d{1,2}) \([A-Z]+\))?$/);
  if (match) {
    const startDate = match[1].replace(/\./g, '-');
    const endDate = match[2] ? `${match[1].slice(0, 5)}${match[2].replace(/\./g, '-')}` : startDate;
    return [startDate, endDate];
  }
  return [null, null];
};

/**
 * Downloads an image from the given URL and saves it locally.
 * @param {string} imageUrl - The URL of the image to download.
 * @param {string} site - The site identifier (e.g., 'rohm_theatre').
 * @param {number} retries - Number of retry attempts for downloading.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, site, retries = 3) => {
  try {
    if (!imageUrl) {
      console.warn('No image URL provided.');
      return '/images/events/placeholder.jpg'; // Ensure this placeholder exists
    }

    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://rohmtheatrekyoto.jp${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

    console.log(`Downloading image: ${absoluteImageUrl}`);

    const response = await axios.get(absoluteImageUrl, { responseType: 'stream' });

    // Determine the file extension
    let extension = path.extname(new URL(absoluteImageUrl).pathname);
    if (!extension || extension === '.php') {
      // Attempt to get extension from Content-Type header
      const contentType = response.headers['content-type'];
      if (contentType) {
        const matches = /image\/(jpeg|png|gif|bmp)/.exec(contentType);
        if (matches && matches[1]) {
          extension = `.${matches[1]}`;
        } else {
          extension = '.jpg'; // Default extension
        }
      } else {
        extension = '.jpg'; // Default extension
      }
    }

    const filename = `${uuidv4()}${extension}`;
    const filepath = path.join(__dirname, '..', 'public', 'images', 'events', site, filename); // Updated path

    // Ensure the directory exists
    fs.mkdirSync(path.dirname(filepath), { recursive: true });

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    // Wait for the download to finish
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Return the relative URL to the image
    const localImageUrl = `/images/events/${site}/${filename}`;
    return localImageUrl;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Retrying download for image: ${imageUrl}. Attempts left: ${retries}`);
      await delay(1000); // Wait before retrying
      return downloadImage(imageUrl, site, retries - 1);
    }
    console.error(`Failed to download image after retries: ${imageUrl}. Error: ${error.message}`);
    // Return path to a placeholder image
    return '/images/events/placeholder.jpg'; // Ensure this placeholder exists
  }
};

// Main scraping function for Rohm Theatre
const scrapeRohmTheatre = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 250,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  console.log('Browser launched.');
  const page = await browser.newPage();
  console.log('New page opened.');

  try {
    console.log('Navigating to Rohm Theatre website...');
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    );
    await page.goto('https://rohmtheatrekyoto.jp/en/program/season2024/', {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    console.log('Page loaded.');

    const eventElements = await page.$$('li.projects-item');
    console.log(`Found ${eventElements.length} event items.`);
    const eventData = [];

    for (const eventElement of eventElements) {
      const status = await eventElement.$eval('.status-box .status span', el => el.innerText.trim()).catch(() => null);
      if (status && (status.toLowerCase() === 'ended' || status.toLowerCase() === 'on now')) {
        console.log(`Event status is "${status}", skipping...`);
        continue;
      }

      const eventDate = await eventElement.$eval('.date', el => el.innerText.trim()).catch(() => null);
      if (!eventDate || eventDate.toLowerCase().includes("details tba") || eventDate.toLowerCase().includes("year-round")) {
        console.log(`Event date is "${eventDate}", invalid or missing, skipping...`);
        continue;
      }

      const [date_start, date_end] = parseDateRange(eventDate);
      if (!date_start) {
        console.log(`Event date "${eventDate}" does not match the expected format, skipping...`);
        continue;
      }

      const today = new Date();
      if (new Date(date_end) < today) {
        console.log(`Event date range "${dateDate}" has already ended, skipping...`);
        continue;
      }

      const linkElement = await eventElement.$('a');
      if (linkElement) {
        try {
          const eventLink = await linkElement.evaluate(el => el.href);
          console.log(`Navigating to event detail page: ${eventLink}`);

          const detailPage = await browser.newPage();
          await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
          console.log(`Navigated to event detail page: ${eventLink}`);

          await delay(3000); // Wait for dynamic content to load

          const rawPriceText = await detailPage.evaluate(() => {
            const priceHeader = [...document.querySelectorAll('h3')].find(
              el => el.textContent.includes('Ticket Prices')
            );
            return priceHeader ? priceHeader.parentElement.innerText.trim() : 'No Ticket Prices found';
          });

          console.log('Raw price text:', rawPriceText);

          const description = await detailPage.$eval('.txt', el => el.innerText.trim()).catch(() => null);
          const title = await eventElement.$eval('.txt h3', el => el.innerText.trim()).catch(() => null);
          const imageUrl = await eventElement.$eval('.pic img', el => el.src).catch(() => null);
          const scheduleText = await detailPage.$eval('.post-detail-box2 p:nth-of-type(2)', el => el.innerHTML.trim()).catch(() => null);
          const venue = await detailPage.$eval('.post-detail-box2 p:nth-of-type(3)', el => el.innerText.trim()).catch(() => 'Rohm Theatre');

          // Parse prices into structured format
          const prices = [];
          if (rawPriceText && rawPriceText !== 'No Ticket Prices found') {
            const priceMatches = rawPriceText.match(/￥?([\d,]+)/g);
            if (priceMatches) {
              priceMatches.forEach((price, index) => {
                prices.push({
                  price_tier: `Tier ${index + 1}`,
                  amount: parseInt(price.replace(/￥|,/g, ''), 10),
                  currency: 'JPY'
                });
              });
            }
          }

          // Download the image and get the local URL
          const localImageUrl = imageUrl && imageUrl !== 'No image available'
            ? await downloadImage(imageUrl, 'rohm_theatre')
            : '/images/events/placeholder.jpg'; // Ensure this placeholder exists

          const eventInfo = {
            title: title || 'No title available',
            date_start,
            date_end,
            venue,
            organization: 'Rohm Theatre',
            image_url: localImageUrl,
            schedule: [
              {
                date: date_start,
                time_start: null,
                time_end: null,
                special_notes: scheduleText
              }
            ],
            prices,
            description: description || 'No description available',
            event_link: eventLink,
            raw_price_text: rawPriceText,
            categories: [], // Add logic for category assignment if needed
            tags: [], // Add logic for tag assignment if needed
            ended: false,
            free: prices.length === 0, // Mark as free if no price data is found
            site: 'rohm_theatre'
          };

          eventData.push(eventInfo);
          console.log('Extracted structured event data:', eventInfo);

          await detailPage.close();
          console.log('Detail page closed.');
        } catch (detailError) {
          console.error('Error navigating to event detail page:', detailError);
        }
      } else {
        console.log('No <a> element found for this event, skipping...');
      }
    }

    console.log('Final cleaned event data:', eventData);
    await browser.close();
    console.log('Browser closed.');
    return eventData.map(event => ({ ...event, site: 'rohm_theatre' }));
  } catch (error) {
    console.error('Error during scraping:', error);
    await browser.close();
    console.log('Browser closed due to error.');
    return [];
  }
};

// Export the scraping function
export default scrapeRohmTheatre;

// Use this block only if you need to run the script directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const data = await scrapeRohmTheatre();
    console.log(JSON.stringify(data, null, 2));
  })();
}
