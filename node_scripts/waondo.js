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

  // Capture console events from the page context and log them in Node.js
  page.on('console', (msg) => {
    for (let i = 0; i < msg.args().length; ++i) {
      console.log(`PAGE LOG: ${msg.args()[i]}`);
    }
  });

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)');
  await page.goto('https://www.waondo.net/%E3%83%A9%E3%82%A4%E3%83%96%E3%82%B9%E3%82%B1%E3%82%B8%E3%83%A5%E3%83%BC%E3%83%AB', {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });

  console.log('Page loaded.');

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

  // Now navigate to each event's detail page to extract the image URL
  for (const event of eventData) {
    if (event.event_link && event.event_link !== 'No link') {
      try {
        await page.goto(event.event_link, { waitUntil: 'networkidle0' });
        // Wait for the image to load
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

        // Set a default image if no image was found
        event.image_url = imageUrl !== 'No image available'
          ? imageUrl
          : 'https://static.wixstatic.com/media/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg/v1/fill/w_1958,h_1112,al_c,q_90,usm_0.66_1.00_0.01,enc_auto/21524a_43377076b1cf45f4addfe4e12782b84b~mv2.jpg';

        console.log(`Extracted image URL for event: ${event.title}, URL: ${event.image_url}`);
      } catch (error) {
        console.error(`Failed to extract image for event: ${event.title}`, error);
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
