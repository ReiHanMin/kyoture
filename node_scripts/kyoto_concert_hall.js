import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import path from 'path';

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Helper function for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Improved date parsing to handle variations
const parseDateRange = (rawDate) => {
  const dateRegex = /(\w+day,\s\w+\s+\d{1,2}\s+\d{4})(?:\s*–\s*(\w+day,\s\w+\s+\d{1,2}\s+\d{4}))?/;
  const matches = rawDate.match(dateRegex);
  if (matches) {
    return [matches[1], matches[2] || matches[1]]; // Use start date as end date if end date is not provided
  }
  return [null, null];
};

// Helper function to split program data into structured list
const parseProgram = (programText) => {
  return programText ? programText.split('\n').map(line => line.trim()).filter(line => line) : [];
};

// Helper function to transform raw price text into structured array
const parsePrice = (priceText) => {
  const priceRegex = /([A-Za-z\s()]+)?\s*￥([\d,]+)/g;
  const prices = [];
  let match;
  while ((match = priceRegex.exec(priceText)) !== null) {
    prices.push({
      price_tier: match[1]?.trim() || 'General',
      amount: parseInt(match[2].replace(/,/g, ''), 10),
      currency: 'JPY',
      discount_info: null, // Add logic for discount info if needed
    });
  }
  return prices;
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
    await page.goto('https://www.kyotoconcerthall.org/en/', { waitUntil: 'load' });
    await delay(3000);
    await page.addStyleTag({ content: `
      .pcdisplay { display: block !important; }
      .spdisplay { display: block !important; }
      * { transition: none !important; animation: none !important; }
    ` });
    await page.waitForSelector('#performancelist li');
    const eventElements = await page.$$('#performancelist li');
    const eventsData = [];

    for (const eventElement of eventElements) {
      const imageUrl = await eventElement.$eval('.photo img', el => el.src).catch(() => 'No image available');
      const performanceInfoButton = await eventElement.$('a.btn_modal_business_en[href="#modal_w"]');
      if (!performanceInfoButton) continue;
      await performanceInfoButton.evaluate(el => el.click());

      // Wait for modal content to load
      await page.waitForSelector('#modal_w .business_detail', { visible: true, timeout: 10000 });
      const modalContent = await page.evaluate(() => {
        const modal = document.querySelector('#modal_w');
        return modal ? modal.innerHTML : null;
      });
      if (!modalContent) continue;

      const eventDetails = await parseModalContent(modalContent);

      // Clean and structure the data
      const [date_start, date_end] = parseDateRange(eventDetails.date);
      const program = parseProgram(eventDetails.program);
      const prices = parsePrice(eventDetails.price);

      const eventInfo = {
        title: eventDetails.title || 'No title available',
        date_start,
        date_end,
        venue: eventDetails.venue || 'Kyoto Concert Hall',
        organization: 'Kyoto Concert Hall',
        image_url: imageUrl,
        program,
        prices, // Use parsed price data
        schedule: [
          {
            date: date_start,
            time_start: eventDetails.time_start || null,
            time_end: null,
            special_notes: null,
          }
        ],
        description: eventDetails.description || 'No description available',
        site: 'kyoto_concert_hall'
      };

      // Ensure required fields are present before pushing
      if (eventInfo.title && eventInfo.date_start && eventInfo.venue) {
        eventsData.push(eventInfo);
        console.log('Extracted event data:', eventInfo);
      }

      const closeButton = await page.$('#modal_w .modal_close');
      if (closeButton) await closeButton.evaluate(el => el.click());
      await delay(500);
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

// Function to parse modal content
const parseModalContent = async (modalHTML) => {
  try {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(modalHTML);
    const document = dom.window.document;

    const title = document.querySelector('.business_detail .title')?.textContent.trim() || 'No title';
    const dateText = document.querySelector('.business_detail .date')?.textContent.trim().replace(/^Date：/, '').trim() || 'No date';
    const venue = document.querySelector('.business_detail .hall')?.textContent.trim().replace(/^Hall：/, '').trim() || 'Kyoto Concert Hall';
    const program = document.querySelector('.business_detail .program')?.textContent.trim().replace(/^Program：/, '').trim() || 'No program';
    const price = document.querySelector('.business_detail .price')?.textContent.trim().replace(/^Price：/, '').trim() || 'No price';
    const releaseDate = document.querySelector('.business_detail .ticket')?.textContent.trim().replace(/^Release date：/, '').trim() || 'No release date';
    const description = document.querySelector('.business_detail .description')?.textContent.trim() || 'No description available';

    // Extract date and time from dateText
    const dateMatch = dateText.match(/(\w+day,\s\w+\s+\d{1,2}\s+\d{4})\s*(\d{1,2}[:：]\d{2})?\s*/);
    const date = dateMatch ? dateMatch[1].trim() : 'No date';
    const time = dateMatch && dateMatch[2] ? dateMatch[2].replace('：', ':').trim() : null;

    return {
      title,
      date,
      venue,
      program,
      price, // Raw price text
      releaseDate,
      description,
      time_start: time, // Add parsed time as time_start
      time_end: null,
    };
  } catch (error) {
    console.error('Error parsing modal content:', error);
    return {
      title: 'No title',
      date: 'No date',
      venue: 'No venue',
      program: 'No program',
      price: 'No price', // Ensure price is returned even on error
      releaseDate: 'No release date',
      description: 'No description available',
      time_start: null,
      time_end: null,
    };
  }
};

export default scrapeKyotoConcertHall;
