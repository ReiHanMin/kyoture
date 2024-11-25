// scraper_kyoto_gattaca.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import path from 'path';

// Use the stealth plugin
puppeteer.use(StealthPlugin());

// Helper function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to parse date from the event date text
const parseDate = (dateText, pageUrl) => {
  const dateMatch = dateText.match(/(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    const month = dateMatch[1];
    const day = dateMatch[2];
    const yearMatch = pageUrl.match(/\/(\d{4})\/(\d{1,2})\.html/);
    let year = new Date().getFullYear();
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
    }
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
};

// Function to parse price data from the price text
const parsePriceData = (priceText) => {
  const prices = [];
  // Adjusted regex to capture price tier (optional) and amount
  const priceRegex = /(?:\b(ADV|DOOR|STUDENT|ticket|ticke)?\b)?\s*￥?([\d,]+)-?/gi;
  let match;

  while ((match = priceRegex.exec(priceText)) !== null) {
    let price_tier = match[1] ? match[1].toUpperCase() : 'General';
    let amount = match[2];
    prices.push({
      price_tier: price_tier,
      amount: parseInt(amount.replace(/,/g, ''), 10),
      currency: 'JPY',
    });
  }
  return prices;
};

const scrapeKyotoGattaca = async () => {
  const browser = await puppeteer.launch({
    headless: true,
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

      // Wait for images to load
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

      await delay(2000);
      visitedUrls.add(currentPageUrl);

      console.log('On the Schedule page.');

      const hasEvents = (await page.$('h2.month_date')) !== null;
      if (!hasEvents) {
        console.log('No events found on this page. Stopping pagination.');
        break;
      }

      const eventElements = await page.$$('div.schedule');

      for (const eventElement of eventElements) {
        try {
          const hasDate = (await eventElement.$('h2.month_date')) !== null;
          if (!hasDate) continue;

          const dateText = await eventElement.$eval('h2.month_date', (el) => el.textContent.trim());
          const dateStr = parseDate(dateText, page.url());
          let title = await eventElement.$eval('h3', (el) => el.innerText.trim());
          title = title.replace(/\n+/g, ' ').trim();

          let imageUrl = await eventElement
            .$eval('div.eventbox span.event a img', (el) => el.src)
            .catch(() => null);
          if (!imageUrl) {
            imageUrl = await eventElement
              .$eval('div.eventbox span.event a', (el) => el.href)
              .catch(() => null);
          }

          const bandsText = await eventElement
            .$eval('div.eventboxpro h6 span.bandname', (el) => el.innerText.trim())
            .catch(() => '');

          const priceEventBox = await eventElement.$$('div.eventbox');
          if (priceEventBox.length >= 3) {
            const pElements = await priceEventBox[2].$$('p'); // Target the third 'eventbox' specifically
            let openTime = null;
            let startTime = null;
            let ticketInfoLink = null;
            let description = '';
            let prices = [];
            let foundPrice = false;

            for (let i = 0; i < pElements.length; i++) {
              const text = await pElements[i].evaluate((el) => el.textContent.trim());
              console.log('Extracted paragraph text:', text);

              if (text.includes('OPEN / START')) {
                // Extract times
                const times = text.replace('OPEN / START', '').trim();
                const timesMatch = times.match(/(\d+:\d+)\s*\/\s*(\d+:\d+)/);
                if (timesMatch) {
                  openTime = timesMatch[1];
                  startTime = timesMatch[2];
                } else if (times.toUpperCase().includes('TBA')) {
                  openTime = 'TBA';
                  startTime = 'TBA';
                }
              } else if (text.includes('OPEN')) {
                // Extract open time
                const timeMatch = text.match(/OPEN\s*(\d+:\d+)/);
                if (timeMatch) {
                  openTime = timeMatch[1];
                }
              } else if (text.includes('START')) {
                // Extract start time
                const timeMatch = text.match(/START\s*(\d+:\d+)/);
                if (timeMatch) {
                  startTime = timeMatch[1];
                }
              } else if (
                text.includes('ADV') ||
                text.includes('DOOR') ||
                text.includes('STUDENT') ||
                text.toLowerCase().includes('ticket') ||
                text.includes('￥') ||
                text.includes('¥')
              ) {
                console.log('Detected price-related text:', text);
                const extractedPrices = parsePriceData(text);
                console.log('Prices extracted:', extractedPrices);
                if (extractedPrices.length > 0) {
                  prices = prices.concat(extractedPrices);
                  foundPrice = true;
                }
              } else if (text.includes('無料') || text.includes('入場無料') || text.includes('🆓')) {
                console.log('Detected free event:', text);
                prices.push({
                  price_tier: 'Free',
                  amount: 0,
                  currency: 'JPY',
                });
                foundPrice = true;
              } else if (text.toLowerCase().includes('ticket info')) {
                // Extract ticket info link
                if (i + 1 < pElements.length) {
                  const linkElement = await pElements[i + 1].$('a.event');
                  if (linkElement) {
                    ticketInfoLink = await linkElement.evaluate((el) => el.href);
                  }
                }
              } else {
                description += text + '\n';
              }
            }

            if (!foundPrice) {
              console.warn(`Price information not found for event: ${title}`);
              // Optionally, set prices to null or leave it empty
              // prices = null;
            }

            const eventInfo = {
              title: title,
              date_start: dateStr,
              date_end: dateStr,
              image_url: imageUrl,
              schedule: [
                {
                  date: dateStr,
                  time_start: openTime,
                  time_end: startTime,
                  special_notes: null,
                },
              ],
              prices: prices.length > 0 ? prices : null,
              venue: 'Kyoto Gattaca',
              organization: 'Kyoto Gattaca',
              description: description.trim(),
              event_link: currentPageUrl,
              categories: [], // Add logic to populate based on title/description
              tags: [], // Add logic to populate based on title/description
              site: 'kyoto_gattaca',
            };

            eventsData.push(eventInfo);
            console.log('Extracted event data:', eventInfo);
          } // End of if (priceEventBox.length >= 3)
        } catch (error) {
          console.error('Error extracting event data:', error);
        }
      } // End of for loop

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
        const nextUrl = new URL(nextLinkHref, page.url()).href;
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
    } // End of while loop

    console.log('Final cleaned event data:', eventsData);
    await browser.close();
    return eventsData.map((event) => ({ ...event, site: 'kyoto_gattaca' }));
  } catch (error) {
    console.error('Error during scraping:', error);
    await browser.close();
    return [];
  }
}; // Ensure this closes the function properly

export default scrapeKyotoGattaca;

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
