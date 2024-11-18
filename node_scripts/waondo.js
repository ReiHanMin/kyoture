import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Use the stealth plugin to evade detection
puppeteer.use(StealthPlugin());

const scrapeWaondo = async () => {
  // Launch Puppeteer with necessary options
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)');
  await page.goto('https://www.waondo.net/%E3%83%A9%E3%82%A4%E3%83%96%E3%82%B9%E3%82%B1%E3%82%B8%E3%83%A5%E3%83%BC%E3%83%AB', {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });

  console.log('Page loaded.');

  const eventData = await page.evaluate(() => {
    const eventDivs = Array.from(document.querySelectorAll('div.j2Owzh.Wprg5l[data-hook="content"]'));
    const events = eventDivs.map(eventDiv => {
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

      // Attempt to extract the start and end date from dateText
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

      // Parse price text into structured prices array
      const prices = [];
      if (priceText !== 'No price information') {
        const priceEntries = priceText.split('/');
        priceEntries.forEach((entry, index) => {
          const priceAmount = entry.match(/￥?([\d,]+)/);
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
        image_url: 'No image available', // Image handling logic can be added if needed
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
        categories: [], // Add logic for category assignment if needed
        tags: [], // Add logic for tag assignment if needed
        ended: false,
        free: prices.length === 0, // Mark as free if no price data is found
        site: 'waondo',
      };
    });

    return events;
  });

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
