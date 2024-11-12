import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Helper function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to parse date from the event date text
const parseDate = (dateText, pageUrl) => {
  // Example dateText: "11月1日FRI"
  // Extract month and day using regex
  const dateMatch = dateText.match(/(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    const month = dateMatch[1];
    const day = dateMatch[2];
    // Extract year from the URL or default to current year
    const yearMatch = pageUrl.match(/\/(\d{4})\/(\d{1,2})\.html/);
    let year = new Date().getFullYear();
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
    }
    // Format the date as YYYY-MM-DD
    const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return dateStr;
  }
  return null;
};

const scrapeKyotoGattaca = async () => {
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
    console.log('Starting to scrape Kyoto Gattaca Schedule pages...');
    const eventsData = [];
    let currentPageUrl = 'http://kyoto-gattaca.jp/schedule/2024/11.html';
    const visitedUrls = new Set();

    while (currentPageUrl && !visitedUrls.has(currentPageUrl)) {
      console.log(`Navigating to ${currentPageUrl}`);
      await page.goto(currentPageUrl, { waitUntil: 'networkidle0' });

      // Wait for all images to load
      await page.evaluate(async () => {
        const selectors = Array.from(document.images).map((img) => img.src);
        await Promise.all(
          selectors.map(
            (src) =>
              new Promise((resolve) => {
                const img = new Image();
                img.src = src;
                img.onload = resolve;
                img.onerror = resolve;
              })
          )
        );
      });

      await delay(2000); // Optional: You can adjust this delay as needed

      visitedUrls.add(currentPageUrl);

      console.log('On the Schedule page.');

      // Check if there are any events on the page by looking for 'h2.month_date'
      const hasEvents = await page.$('h2.month_date') !== null;

      if (!hasEvents) {
        console.log('No events found on this page. Stopping pagination.');
        break;
      }

      // Now select all event divs
      const eventElements = await page.$$('div.schedule');

      // Proceed to process eventElements
      for (const eventElement of eventElements) {
        try {
          // Check if 'h2.month_date' exists within the eventElement
          const hasDate = await eventElement.$('h2.month_date') !== null;
          if (!hasDate) {
            // Skip this eventElement
            continue;
          }

          // Extract date
          const dateText = await eventElement.$eval('h2.month_date', (el) =>
            el.textContent.trim()
          );
          const dateStr = parseDate(dateText, page.url());

          // Extract title (handle multiple lines)
          let title = await eventElement.$eval('h3', (el) => el.innerText.trim());
          // Clean up the title
          title = title.replace(/\n+/g, ' ').trim();

          // Extract image URL
          let imageUrl = await eventElement
            .$eval('div.eventbox span.event a img', (el) => el.src)
            .catch(() => null);
          // If image URL is not directly available, get from the href attribute
          if (!imageUrl) {
            imageUrl = await eventElement
              .$eval('div.eventbox span.event a', (el) => el.href)
              .catch(() => null);
          }

          // Extract bands/artists
          const bandsText = await eventElement
            .$eval('div.eventboxpro h6 span.bandname', (el) => el.innerText.trim())
            .catch(() => '');

          // Extract event details from the eventbox div
          const pElements = await eventElement.$$('div.eventbox p');
          let openTime = null;
          let startTime = null;
          let advPrice = null;
          let doorPrice = null;
          let otherPrices = [];
          let ticketInfoLink = null;
          let description = '';

          for (let i = 0; i < pElements.length; i++) {
            const text = await pElements[i].evaluate((el) => el.textContent.trim());
            if (text.includes('OPEN / START')) {
              // Extract open and start times
              const times = text.replace('OPEN / START', '').trim();
              const timesMatch = times.match(/(\d+:\d+)\s*\/\s*(\d+:\d+)/);
              if (timesMatch) {
                openTime = timesMatch[1];
                startTime = timesMatch[2];
              } else if (times.toUpperCase().includes('TBA')) {
                openTime = 'TBA';
                startTime = 'TBA';
              }
            } else if (
              text.includes('ADV / DOOR') ||
              text.includes('ADV / STUDENT') ||
              text.includes('ticket') ||
              text.includes('ticke')
            ) {
              // Extract ticket prices
              const prices = text
                .replace(/ADV \/ DOOR|ADV \/ STUDENT|ticket|ticke|ADV \/ student/gi, '')
                .trim();
              const pricesMatch = prices.match(/￥?([\d,]+)-\s*\/\s*￥?([\d,]+)-/);
              if (pricesMatch) {
                advPrice = pricesMatch[1];
                doorPrice = pricesMatch[2];
              } else {
                // Handle single price or different formats
                advPrice = prices;
              }
            } else if (text.toLowerCase().includes('ticket info')) {
              // Ticket info link is in the next <p>
              if (i + 1 < pElements.length) {
                const linkElement = await pElements[i + 1].$('a.event');
                if (linkElement) {
                  ticketInfoLink = await linkElement.evaluate((el) => el.href);
                }
              }
            } else if (text.includes('+1Drink') || text.includes('+2Drink')) {
              // Optional: Handle drink charges if needed
            } else if (text.trim() === '') {
              // Skip empty text
            } else {
              // Other text (could be descriptions or special notes)
              description += text + '\n';
            }
          }

          // Build the event info object
          const eventInfo = {
            date: dateStr,
            title: title,
            image_url: imageUrl,
            bands: bandsText,
            open_time: openTime,
            start_time: startTime,
            adv_price: advPrice,
            door_price: doorPrice,
            ticket_info: ticketInfoLink,
            description: description.trim(),
            event_link: currentPageUrl,
            venue: 'Kyoto Gattaca',
            site: 'kyoto_gattaca',
          };

          eventsData.push(eventInfo);
          console.log('Extracted event data:', eventInfo);
        } catch (error) {
          console.error('Error extracting event data:', error);
        }
      }

      // Find the "next" link
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
        // Resolve the href against the current page URL using page.url()
        const nextUrl = new URL(nextLinkHref, page.url()).href;
        // Check if we've already visited this URL to prevent infinite loops
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
    }

    console.log('Final cleaned event data:', eventsData);

    await browser.close();
    return eventsData.map((event) => ({ ...event, site: 'kyoto_gattaca' }));
  } catch (error) {
    console.error('Error during scraping:', error);
    await browser.close();
    return [];
  }
};

export default scrapeKyotoGattaca;

// Use this block only if you need to run the script directly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.argv[1] === __filename) {
  (async () => {
    try {
      const data = await scrapeKyotoGattaca();
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('An error occurred:', error);
    }
  })();
}
