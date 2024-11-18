import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';

// Use stealth plugin
puppeteer.use(StealthPlugin());

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Main scraping function for Kakubarhythm
const scrapeKakubarhythm = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 250,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  console.log('Browser launched.');
  const page = await browser.newPage();
  console.log('New page opened.');

  try {
    console.log('Navigating to Kakubarhythm live events page...');
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    );
    await page.goto('https://kakubarhythm.com/live', {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    console.log('Page loaded.');

    const eventElements = await page.$$('article');
    console.log(`Found ${eventElements.length} event items.`);
    const eventData = [];

    for (const eventElement of eventElements) {
      try {
        const dateText = await eventElement.$eval('.live-top-date', el => el.innerText.trim()).catch(() => null);
        const eventTitle = await eventElement.$eval('.live-top-event', el => el.innerText.trim()).catch(() => 'Unnamed Event');
        const performer = await eventElement.$eval('.live-top-cat p', el => el.innerText.trim()).catch(() => 'Unknown Performer');
        const venue = await eventElement.$eval('.live-top-place', el => el.innerText.trim()).catch(() => 'Unknown Venue');
        const eventLink = await eventElement.$eval('a.overimg', el => el.href).catch(() => null);

        const dateMatch = dateText ? dateText.match(/(\d{4}\.\d{1,2}\.\d{1,2})/) : null;
        const date_start = dateMatch ? dateMatch[0].replace(/\./g, '-') : null;
        const date_end = date_start; // Assuming single-day events for simplicity

        if (eventLink) {
          console.log(`Navigating to event detail page: ${eventLink}`);
          const detailPage = await browser.newPage();
          await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await delay(3000); // Ensure full load of page content

          const description = await detailPage.$eval('.entry-content', el => el.innerText.trim()).catch(() => 'No description available');
          const timeText = await detailPage.$eval('h3.fwb.fco + p', el => el.innerText.trim()).catch(() => null);
          const ticketInfo = await detailPage.evaluate(() => {
            const ticketHeader = [...document.querySelectorAll('h3')].find(el => el.textContent.includes('TICKET'));
            return ticketHeader ? ticketHeader.nextElementSibling.innerText.trim() : 'No ticket information';
          });

          console.log('Ticket info:', ticketInfo);

          // Extract start and end times if available
          let time_start = null;
          let time_end = null;
          if (timeText && timeText.includes('/')) {
            [time_start, time_end] = timeText.split('/').map(time => time.trim() + ':00');
          }

          const prices = [];
          if (ticketInfo && ticketInfo !== 'No ticket information') {
            const priceMatches = ticketInfo.match(/￥?([\d,]+)/g);
            if (priceMatches) {
              priceMatches.forEach((price, index) => {
                prices.push({
                  price_tier: `Tier ${index + 1}`,
                  amount: price.replace(/￥|,/g, ''),
                  currency: 'JPY',
                  discount_info: null, // Add logic to parse discount info if available
                });
              });
            }
          }

          const eventInfo = {
            title: eventTitle,
            date_start,
            date_end,
            time_start,
            time_end,
            venue,
            organization: performer,
            image_url: 'https://kakubarhythm.com/wordpress/wp-content/uploads/2024/10/mainvisual_pc_20241031.jpg',
            schedule: [
              {
                date: date_start,
                time_start,
                time_end,
                special_notes: null,
              }
            ],
            prices,
            description,
            event_link: eventLink,
            raw_price_text: ticketInfo,
            categories: [], // Add category assignment logic if needed
            tags: [], // Add tag assignment logic if needed
            ended: false,
            free: prices.length === 0,
            site: 'kakubarhythm',
          };

          eventData.push(eventInfo);
          console.log('Extracted structured event data:', eventInfo);
          await detailPage.close();
        } else {
          console.log('No valid event link found, skipping...');
        }
      } catch (error) {
        console.error('Error processing event:', error);
      }
    }

    console.log('Final event data:', eventData);
    await browser.close();
    console.log('Browser closed.');
    return eventData.map(event => ({ ...event, site: 'kakubarhythm' }));
  } catch (error) {
    console.error('Error during scraping:', error);
    await browser.close();
    console.log('Browser closed due to error.');
    return [];
  }
};

export default scrapeKakubarhythm;

// Use this block only if you need to run the script directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const data = await scrapeKakubarhythm();
    console.log(JSON.stringify(data, null, 2));
  })();
}
