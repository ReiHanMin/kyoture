// kyoto_concert_hall.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import axios from 'axios';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

// Define __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Environment Variables (Optional)
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// Helper function for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to split program data into structured list
const parseProgram = (programText) => {
  return programText ? programText.split('\n').map(line => line.trim()).filter(line => line) : [];
};

// Enhanced helper function to transform raw price text into structured array
const parsePrice = (priceText) => {
  const prices = [];
  
  // Define main tiers
  const mainTiers = ['Adults', 'General', 'Club Members', 'Under 22', 'Students'];
  
  // Split the priceText by '/' to handle multiple prices
  const priceParts = priceText.split('/').map(part => part.trim());
  
  // Regular expression to capture [Main Tier] [Sub Tier] ￥[Amount]
  const priceRegex = new RegExp(`^(${mainTiers.join('|')})?(?:\\s*([A-Z]))?\\s*￥([\\d,]+)`, 'i');
  
  for (const part of priceParts) {
    const match = part.match(priceRegex);
    if (match) {
      let [_, mainTier, subTier, amount] = match;
      
      // If mainTier is missing but subTier exists, infer mainTier based on context
      if (!mainTier && subTier) {
        // Implement logic to infer mainTier if possible
        // For now, skip if mainTier is not present
        console.warn(`Main tier missing for price part: "${part}". Skipping.`);
        continue;
      }
      
      mainTier = mainTier ? mainTier.trim() : 'General'; // Default to 'General' if mainTier is missing
      
      // Normalize mainTier to match allowed list
      mainTier = mainTier.includes('Club Members') ? 'Club Members' :
                 mainTier.includes('Under 22') ? 'Under 22' :
                 mainTier.includes('Students') ? 'Students' :
                 mainTier.includes('Adults') ? 'Adults' : mainTier;
      
      // Validate mainTier
      if (!mainTiers.includes(mainTier)) {
        console.warn(`Invalid main tier "${mainTier}" in price part: "${part}". Skipping.`);
        continue; // Skip invalid mainTiers
      }
      
      // Push the price object
      prices.push({
        price_tier: mainTier,
        amount: parseInt(amount.replace(/,/g, ''), 10),
        currency: 'JPY',
        discount_info: null, // Add logic for discount info if needed
      });
    } else {
      // Handle cases like "Admission free"
      if (part.toLowerCase().includes('free')) {
        prices.push({
          price_tier: 'Free',
          amount: 0,
          currency: 'JPY',
          discount_info: null,
        });
      } else {
        console.warn(`Unrecognized price format: "${part}". Skipping.`);
      }
    }
  }
  
  return prices;
};

/**
 * Downloads an image from the given URL and saves it locally.
 * @param {string} imageUrl - The URL of the image to download.
 * @returns {Promise<string>} - The relative URL of the saved image.
 */
const downloadImage = async (imageUrl, retries = 3) => {
  try {
    // Ensure the image URL is absolute
    const absoluteImageUrl = imageUrl.startsWith('http')
      ? imageUrl
      : `https://www.kyotoconcerthall.org${imageUrl.startsWith('/') ? '' : '/'}${imageUrl.replace('../', '')}`;

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
    const filepath = path.join(__dirname, '..', 'public', 'images', 'events', filename); // Updated path

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
    const localImageUrl = `/images/events/${filename}`;
    return localImageUrl;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Retrying download for image: ${imageUrl}. Attempts left: ${retries}`);
      await delay(1000); // Wait before retrying
      return downloadImage(imageUrl, retries - 1);
    }
    console.error(`Failed to download image after retries: ${imageUrl}. Error: ${error.message}`);
    // Return path to a placeholder image
    return '/images/events/placeholder_kch.jpg'; // Ensure this placeholder exists
  }
};


// Function to parse modal content
const parseModalContent = async (modalHTML) => {
  try {
    console.log('--- Parsing Modal Content ---');
    console.log('Modal HTML:', modalHTML); // Debugging: Log the entire modal HTML

    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(modalHTML);
    const document = dom.window.document;

    // Updated selectors without '.business_detail'
    const title = document.querySelector('.title')?.textContent.trim() || 'No title';
    const dateText = document.querySelector('.date')?.textContent.trim().replace(/^Date：/, '').trim() || 'No date';
    const venue = document.querySelector('.hall')?.textContent.trim().replace(/^Hall：/, '').trim() || 'Kyoto Concert Hall';
    const program = document.querySelector('.program')?.textContent.trim().replace(/^Program：/, '').trim() || 'No program';
    const price = document.querySelector('.price')?.textContent.trim().replace(/^Price：/, '').trim() || 'No price';
    
    // Extract 'Release date' from the correct '.ticket' element
    const releaseDateElement = Array.from(document.querySelectorAll('.ticket')).find(el => el.textContent.includes('Release date：'));
    const releaseDate = releaseDateElement ? releaseDateElement.textContent.trim().replace(/^Release date：/, '').trim() : 'No release date';
    
    // Description might not be present; handle accordingly
    const description = document.querySelector('.description')?.textContent.trim() || 'No description available';

    // Debugging: Log extracted fields
    console.log('Extracted Fields:', { title, dateText, venue, program, price, releaseDate, description });

    // Extract date and time from dateText
    const dateMatch = dateText.match(/(\w+day,\s\w+\s+\d{1,2}\s+\d{4})\s+(\d{1,2}[:：]\d{2})?/);
    if (!dateMatch) {
      console.warn(`No date matched in parseDateRange for rawDate: ${dateText}`);
      return {
        title,
        date: 'No date',
        venue,
        program,
        price,
        releaseDate,
        description,
        time_start: null,
        time_end: null,
      };
    }
    const date = dateMatch[1].trim();
    const time = dateMatch[2] ? dateMatch[2].replace('：', ':').trim() : null;

    return {
      title,
      date,
      venue,
      program,
      price, // Raw price text
      releaseDate,
      description,
      time_start: time,
      time_end: null,
    };
  } catch (error) {
    console.error('Error parsing modal content:', error);
    console.log('Modal HTML:', modalHTML);
    return {
      title: 'No title',
      date: 'No date',
      venue: 'No venue',
      program: 'No program',
      price: 'No price',
      releaseDate: 'No release date',
      description: 'No description available',
      time_start: null,
      time_end: null,
    };
  }
};

// Main scraping function for Kyoto Concert Hall
const scrapeKyotoConcertHall = async () => {
  const browser = await puppeteer.launch({
    headless: true, // Set to true for production
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  try {
    console.log('Navigating to Kyoto Concert Hall website...');
    await page.goto('https://www.kyotoconcerthall.org/en/', { waitUntil: 'load', timeout: 30000 });
    await delay(3000); // Wait for dynamic content to load

    // Force display of elements (if needed)
    await page.addStyleTag({ content: `
      .pcdisplay { display: block !important; }
      .spdisplay { display: block !important; }
      * { transition: none !important; animation: none !important; }
    ` });

    // Wait for the events list to load
    await page.waitForSelector('#performancelist li', { timeout: 15000 });
    const eventElements = await page.$$('#performancelist li');
    const eventsData = [];

    for (const eventElement of eventElements) {
      try {
        // Extract image URL
        const imageUrl = await eventElement.$eval('.photo img', el => el.getAttribute('src')).catch(() => 'No image available');

        // Click the "Performance info" button to open the modal
        const performanceInfoButton = await eventElement.$('a.btn_modal_business_en[href="#modal_w"]');
        if (!performanceInfoButton) {
          console.warn('No Performance Info button found for an event. Skipping...');
          continue;
        }
        await performanceInfoButton.evaluate(el => el.click());

        // Wait for the modal to appear
        await page.waitForSelector('#modal_w', { visible: true, timeout: 10000 });

        // Wait for the modal content to be populated
        await page.waitForFunction(() => {
          const modal = document.querySelector('#modal_w');
          return modal && modal.innerText.trim().length > 0;
        }, { timeout: 10000 });

        // Extract modal content
        const modalContent = await page.$eval('#modal_w', el => el.innerHTML).catch(() => null);
        if (!modalContent) {
          console.warn('Modal content not found. Skipping this event...');
          // Close the modal before continuing
          const closeButton = await page.$('#modal_w .modal_close');
          if (closeButton) {
            await closeButton.evaluate(el => el.click());
            await delay(500);
          }
          continue;
        }

        // Parse the modal content
        const eventDetails = await parseModalContent(modalContent);

        // Clean and structure the data
        const date_start = eventDetails.date || null;
        const date_end = eventDetails.date || null;
        const time_start = eventDetails.time_start || null;
        const program = parseProgram(eventDetails.program);
        const prices = parsePrice(eventDetails.price);

        // Now download the image and get the local URL
        const localImageUrl = imageUrl !== 'No image available'
          ? await downloadImage(imageUrl)
          : '/images/events/placeholder.jpg'; // Ensure this placeholder exists

        const eventInfo = {
          title: eventDetails.title || 'No title available',
          date_start,
          date_end,
          venue: eventDetails.venue || 'Kyoto Concert Hall',
          organization: 'Kyoto Concert Hall',
          image_url: localImageUrl,
          program,
          prices, // Use parsed price data
          schedule: [
            {
              date: date_start,
              time_start: time_start || null,
              time_end: null,
              special_notes: null,
            }
          ],
          description: eventDetails.description || 'No description available',
          site: 'kyoto_concert_hall'
        };

        // Ensure required fields are present before pushing
        if (eventInfo.title && eventInfo.date_start && eventInfo.venue && eventInfo.image_url) {
          eventsData.push(eventInfo);
          console.log('Extracted event data:', eventInfo);
        } else {
          console.warn('Incomplete event data found and skipped:', eventInfo);
        }

        // Close the modal
        const closeButton = await page.$('#modal_w .modal_close');
        if (closeButton) {
          await closeButton.evaluate(el => el.click());
          await delay(500); // Wait for modal to close
        }
      } catch (error) {
        console.error('Error processing an event:', error);
        // Attempt to close the modal if an error occurs
        const closeButton = await page.$('#modal_w .modal_close');
        if (closeButton) {
          await closeButton.evaluate(el => el.click());
          await delay(500);
        }
        continue; // Proceed to the next event
      }
    }

    console.log('Final cleaned event data:', eventsData);
    await browser.close();
    return eventsData.map(event => ({ ...event, site: 'kyoto_concert_hall' }));
  } catch (error) {
    console.error('Error during scraping:', error);
    await browser.close();
    return [];
  }
};

// Export the scraping function
export default scrapeKyotoConcertHall;
