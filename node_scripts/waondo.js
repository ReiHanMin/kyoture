import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';

// Use the stealth plugin to evade detection
puppeteer.use(StealthPlugin());

/**
 * Utility function to generate a SHA256 hash of a given string.
 * @param {string} str - The input string to hash.
 * @returns {string} - The resulting SHA256 hash in hexadecimal format.
 */
const generateHash = (str) => {
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Utility function to download an image from a URL and save it to a specified path.
 * @param {string} url - The image URL to download.
 * @param {string} filepath - The local file path where the image will be saved.
 * @returns {Promise<void>}
 */
const downloadImage = async (url, filepath) => {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000, // 30 seconds timeout
    });

    const writer = fs.createWriteStream(filepath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`Image downloaded and saved to: ${filepath}`);
        resolve();
      });
      writer.on('error', (err) => {
        console.error(`Error writing image to ${filepath}:`, err.message);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Failed to download image from ${url}:`, error.message);
    throw error;
  }
};

const scrapeWaondo = async () => {
  // Define the directory where images will be saved
  // Navigate one level up from 'node_scripts' to 'kyoture'
  const imagesDir = path.join(process.cwd(), '..', 'public', 'images', 'events', 'waondo');

  // Create the directory if it doesn't exist
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log(`Created directory: ${imagesDir}`);
  } else {
    console.log(`Directory already exists: ${imagesDir}`);
  }

  // Launch Puppeteer with necessary options
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Capture console events from the page context and log them in Node.js
  page.on('console', (msg) => {
    for (let i = 0; i < msg.args().length; ++i) {
      console.log(`PAGE LOG: ${msg.args()[i]}`);
    }
  });

  // Set a realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)');

  // Navigate to the main events page
  await page.goto('https://www.waondo.net/%E3%83%A9%E3%82%A4%E3%83%96%E3%82%B9%E3%82%B1%E3%82%B8%E3%83%A5%E3%83%BC%E3%83%AB', {
    waitUntil: 'networkidle0',
    timeout: 60000, // 60 seconds timeout
  });

  console.log('Page loaded.');

  // Extract event data from the main page
  const eventData = await page.evaluate(() => {
    const eventDivs = Array.from(document.querySelectorAll('div.j2Owzh.Wprg5l[data-hook="content"]'));
    console.log('Total event divs found:', eventDivs.length);

    const events = eventDivs.map((eventDiv, index) => {
      console.log(`Event ${index} processing...`);
      console.log(`Event ${index} HTML:`, eventDiv.outerHTML);

      const titleElement = eventDiv.querySelector('div[data-hook="title"] a');
      const title = titleElement ? titleElement.textContent.trim() : 'No title';
      const dateElement = eventDiv.querySelector('div[data-hook="date"]');
      const dateText = dateElement ? dateElement.textContent.trim() : 'No date';
      const locationElement = eventDiv.querySelector('div[data-hook="location"]');
      const location = locationElement ? locationElement.textContent.trim() : 'No location';
      const descriptionElement = eventDiv.querySelector('div[data-hook="description"]');
      const description = descriptionElement ? descriptionElement.textContent.trim() : 'No description';
      const event_link = titleElement ? titleElement.href : 'No link';
      const priceMatch = description.match(/【料金】(.+)/);
      const priceText = priceMatch ? priceMatch[1].trim() : 'No price information';

      // Set a placeholder for the image URL
      let image_url = 'No image available';

      // Process date and prices as before
      let date_start = null;
      let date_end = null;
      const dateParts = dateText.split(' - ');
      if (dateParts.length === 2) {
        date_start = dateParts[0].trim();
        date_end = dateParts[1].trim();
      } else {
        date_start = dateText;
        date_end = dateText;
      }

      const prices = [];
      if (priceText !== 'No price information') {
        const priceEntries = priceText.split('/');
        priceEntries.forEach((entry, index) => {
          const priceAmount = entry.match(/¥?([\d,]+)/);
          if (priceAmount) {
            prices.push({
              price_tier: `Tier ${index + 1}`,
              amount: priceAmount[1].replace(/,/g, ''),
              currency: 'JPY',
            });
          }
        });
      }

      return {
        title,
        date_start,
        date_end,
        venue: location,
        image_url, // Placeholder
        schedule: [
          {
            date: date_start,
            time_start: null,
            time_end: null,
            special_notes: null,
          },
        ],
        description,
        event_link,
        prices,
        categories: [],
        tags: [],
        ended: false,
        free: prices.length === 0,
        site: 'waondo',
      };
    });

    return events;
  });

  // Set to keep track of already downloaded images to prevent duplicates
  const downloadedImages = new Set();

  // Iterate over each event to extract and download images
  for (const event of eventData) {
    if (event.event_link && event.event_link !== 'No link') {
      try {
        await page.goto(event.event_link, { waitUntil: 'networkidle0', timeout: 60000 });

        // Wait for the image selector to appear
        await page.waitForSelector('[data-hook="event-image"] img', { timeout: 5000 });

        // Extract the image URL from the detail page
        const imageUrl = await page.evaluate(() => {
          const eventImageDiv = document.querySelector('[data-hook="event-image"]');
          if (eventImageDiv) {
            const imgEl = eventImageDiv.querySelector('img');
            if (imgEl) {
              return imgEl.src;
            }
          }
          return 'No image available';
        });

        // Set the image URL, using a default placeholder if necessary
        event.image_url = imageUrl !== 'No image available'
          ? imageUrl
          : 'https://static.wixstatic.com/media/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg/v1/fill/w_1958,h_1112,al_c,q_90,usm_0.66_1.00_0.01,enc_auto/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg';

        console.log(`Extracted image URL for event: ${event.title}, URL: ${event.image_url}`);

        // Proceed to download the image if it's not already downloaded
        if (event.image_url !== 'No image available' && !downloadedImages.has(event.image_url)) {
          // Generate a unique filename using SHA256 hash of the image URL
          const imageHash = generateHash(event.image_url);
          const imageExtension = path.extname(new URL(event.image_url).pathname).split('?')[0] || '.jpg'; // Handle URLs with query params
          const imageFilename = `${imageHash}${imageExtension}`;
          const imagePathLocal = path.join(imagesDir, imageFilename);

          // Check if the image file already exists
          if (!fs.existsSync(imagePathLocal)) {
            try {
              await downloadImage(event.image_url, imagePathLocal);
              downloadedImages.add(event.image_url);
              // Update the image_url to point to the local path
              event.image_url = `/images/events/waondo/${imageFilename}`;
            } catch (downloadError) {
              console.error(`Failed to download image for event: ${event.title}. Using placeholder.`);
              event.image_url = 'https://static.wixstatic.com/media/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg/v1/fill/w_1958,h_1112,al_c,q_90,usm_0.66_1.00_0.01,enc_auto/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg';
            }
          } else {
            console.log(`Image already exists locally: ${imageFilename}`);
            // Update the image_url to point to the local path
            event.image_url = `/images/events/waondo/${imageFilename}`;
          }
        } else {
          if (event.image_url === 'No image available') {
            console.warn(`No image found for event: ${event.title}. Using placeholder.`);
          } else {
            console.log(`Image already downloaded for URL: ${event.image_url}`);
            // Assuming the image has been downloaded previously, construct the local path
            const imageHash = generateHash(event.image_url);
            const imageExtension = path.extname(new URL(event.image_url).pathname).split('?')[0] || '.jpg';
            const imageFilename = `${imageHash}${imageExtension}`;
            event.image_url = `/images/events/waondo/${imageFilename}`;
          }
        }
      } catch (error) {
        console.error(`Failed to extract or download image for event: ${event.title}`, error.message);
        // Assign stock image URL if an error occurs
        event.image_url = 'https://static.wixstatic.com/media/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg/v1/fill/w_1958,h_1112,al_c,q_90,usm_0.66_1.00_0.01,enc_auto/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg';
      }
    }
  }

  // Save the data to a JSON file for manual inspection
  fs.writeFileSync('waondo_events.json', JSON.stringify(eventData, null, 2));
  console.log('Data saved to waondo_events.json');

  await browser.close();
  return eventData;
};

export default scrapeWaondo;

// If the script is run directly, execute the scraping function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      const data = await scrapeWaondo();
      console.log('Scraped Data:', data);
    } catch (error) {
      console.error('An error occurred during scraping:', error);
    }
  })();
}
