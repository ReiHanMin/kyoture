import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';

// Use stealth plugin
puppeteer.use(StealthPlugin());

// Helper function for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to parse dates in the "YYYY.MM.DD – MM.DD" format
const parseDateRange = (dateText) => {
  const match = dateText.match(/^(\d{4}\.\d{1,2}\.\d{1,2}) \([A-Z]+\)(?: – (\d{1,2}\.\d{1,2}) \([A-Z]+\))?$/);
  if (match) {
    const startDate = match[1].replace(/\./g, '-');
    const endDate = match[2] ? `${match[1].slice(0, 5)}${match[2].replace(/\./g, '-')}` : startDate;
    return [startDate, endDate];
  }
  return [null, null];
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
        console.log(`Event date range "${eventDate}" has already ended, skipping...`);
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

          await delay(3000);

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
                  amount: price.replace(/￥|,/g, ''),
                  currency: 'JPY'
                });
              });
            }
          }

          const eventInfo = {
            title,
            date_start,
            date_end,
            venue,
            organization: 'Rohm Theatre',
            image_url: imageUrl || 'No image available',
            schedule: [
              {
                date: date_start,
                time_start: null,
                time_end: null,
                special_notes: scheduleText
              }
            ],
            prices,
            description: description || null,
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

export default scrapeRohmTheatre;

// Use this block only if you need to run the script directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const data = await scrapeRohmTheatre();
    console.log(JSON.stringify(data, null, 2));
  })();
}
