import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';

// Use stealth plugin
puppeteer.use(StealthPlugin());

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Main scraping function for Rohm Theatre
const scrapeRohmTheatre = async () => {
  const browser = await puppeteer.launch({
    headless: true, // Set to true for production
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

    // Handle consent pop-ups if necessary
    const consentButton = await page.$('.cc-allow');
    if (consentButton) {
      await consentButton.click();
      console.log('Accepted cookie consent.');
    }

    // Scroll to the bottom of the page to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    console.log('Scrolled to the bottom of the page.');

    // Wait for event items to load
    await page.waitForSelector('li.projects-item', { visible: true, timeout: 60000 });
    console.log('Event items are present.');

    // Extract event data
    const eventElements = await page.$$('li.projects-item');
    console.log(`Found ${eventElements.length} event items.`);
    const eventData = [];

    for (const eventElement of eventElements) {
      // Extract the status of the event
      const status = await eventElement.$eval('.status-box .status span', el => el.innerText.trim()).catch(() => null);
      
      // Check if the status is "Ended" or "On Now" and skip if true
      if (status && (status.toLowerCase() === 'ended' || status.toLowerCase() === 'on now')) {
        console.log(`Event status is "${status}", skipping...`);
        continue;
      }

      // Extract the date from the .date div
      const eventDate = await eventElement.$eval('.date', el => el.innerText.trim()).catch(() => null);

      // Skip events with missing dates or placeholders
      if (!eventDate || eventDate.toLowerCase().includes("details tba") || eventDate.toLowerCase().includes("year-round")) {
        console.log(`Event date is "${eventDate}", invalid or missing, skipping...`);
        continue;
      }

      // Handle date ranges like "YYYY.MM.DD (DAY) – MM.DD (DAY)" or single dates
      const dateRangeMatch = eventDate.match(/^(\d{4}\.\d{1,2}\.\d{1,2}) \([A-Z]+\)(?: – (\d{1,2}\.\d{1,2}) \([A-Z]+\))?$/);
      if (dateRangeMatch) {
        const startDate = new Date(dateRangeMatch[1]);
        const endDate = dateRangeMatch[2] ? new Date(`${dateRangeMatch[1].slice(0, 5)}${dateRangeMatch[2]}`) : startDate;
        
        // If the end date is before today, skip the event
        const today = new Date();
        if (endDate < today) {
          console.log(`Event date range "${eventDate}" has already ended, skipping...`);
          continue;
        }
      } else {
        console.log(`Event date "${eventDate}" does not match the expected format, skipping...`);
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

          await delay(3000); // Wait for 3 seconds to ensure complete page loading

          // Check for the presence of .post-detail-box2
          const scheduleBox = await detailPage.$('.post-detail-box2');
          if (!scheduleBox) {
            console.log('No .post-detail-box2 found. Assuming event has ended, skipping...');
            await detailPage.close();
            continue;
          }

          // Extract raw price text
          const rawPriceText = await detailPage.evaluate(() => {
            const priceHeader = [...document.querySelectorAll('h3')].find(
              el => el.textContent.includes('Ticket Prices')
            );
            return priceHeader ? priceHeader.parentElement.innerText.trim() : 'No Ticket Prices found';
          });

          console.log('Raw price text:', rawPriceText);

          // Extract description from the detail page
          const description = await detailPage.$eval('.txt', el => el.innerText.trim()).catch(() => null);

          // Extract title, date, venue, and image from the main page
          const title = await eventElement.$eval('.txt h3', el => el.innerText.trim()).catch(() => null);
          const date = await eventElement.$eval('.txt .date', el => el.innerText.trim()).catch(() => null);
          const imageUrl = await eventElement.$eval('.pic img', el => el.src).catch(() => null);

          // Extract schedule data from the detail page
          const scheduleText = await scheduleBox.$eval('p:nth-of-type(2)', el => el.innerHTML.trim()).catch(() => null);

          console.log('Raw schedule text:', scheduleText);

          // Extract venue information
          const venue = await scheduleBox.$eval('p:nth-of-type(3)', el => el.innerText.trim()).catch(() => null);

          // Push the raw event data to the array
          const eventInfo = {
            title,
            raw_date: date,
            raw_schedule: scheduleText,
            venue: venue || 'Rohm Theatre',
            organization: 'Rohm Theatre',
            description: description || null,
            image_url: imageUrl || 'No image available',
            event_link: eventLink || 'No link available',
            raw_price_text: rawPriceText,
            site: 'rohm_theatre' // Add site field
          };

          eventData.push(eventInfo);
          console.log('Extracted raw event data:', eventInfo);

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

export default scrapeRohmTheatre;

// Use this block only if you need to run the script directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const data = await scrapeRohmTheatre();
    console.log(JSON.stringify(data, null, 2));
  })();
}
