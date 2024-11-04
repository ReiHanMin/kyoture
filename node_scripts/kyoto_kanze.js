import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeKyotoKanze = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    slowMo: 250,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)');
  await page.goto('http://kyoto-kanze.jp/show_info/', { waitUntil: 'networkidle0', timeout: 60000 });

  console.log('Main page loaded.');

  const eventData = [];
  const eventDivs = await page.$$('.link'); // Select all event containers

  for (const eventDiv of eventDivs) {
    try {
      // Check if the event is a free event by looking for "無料公演" comment
      const innerHTML = await page.evaluate(el => el.innerHTML, eventDiv);
      const isFreeEvent = innerHTML.includes('<!-- 無料公演 -->');

      if (isFreeEvent) {
        // Free event - get details directly from the main page
        const title = await eventDiv.$eval('.midashi', el => el.innerText.trim()).catch(() => 'No title');
        const dateAndTime = await eventDiv.$eval('.bl_title', el => el.innerText.trim()).catch(() => 'No date/time');

        const mainText = await eventDiv.$$eval('.box p', els => els.map(el => el.innerText.trim()));
        const host = mainText.find(text => text.includes('主催：'))?.replace('主催：', '').trim() || 'No host';
        const price = mainText.find(text => text.includes('無料')) || '無料';

        eventData.push({
          title,
          date_and_time: dateAndTime,
          host,
          price,
          ticket_link: 'No ticket link available',
          images: [],
          ended: false,
          free: true,
          venue: "Kyoto Kanze",
        });

        console.log('Extracted free event data:', title);

      } else {
        // Paid event - click on the event link to access the detailed page
        const eventLink = await eventDiv.$eval('a', el => el.href);
        const detailPage = await browser.newPage();
        await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`Opened detail page: ${eventLink}`);

        // Extract detailed information from the paid event page
        const title = await detailPage.$eval('#content h2', el => el.innerText.trim()).catch(() => 'No title');
        const dateAndTime = await detailPage.$eval('.blank01', el => el.innerText.trim()).catch(() => 'No date and time');
        const host = await detailPage.$eval('.blank02', el => el.innerText.includes('主催') ? el.innerText.replace('主催：', '').trim() : 'No host').catch(() => 'No host');
        const price = await detailPage.$eval('.blank02:nth-of-type(3)', el => el.innerText.trim()).catch(() => 'No price');
        const ticketLink = await detailPage.$eval('.blank02:nth-of-type(3) a', el => el.href).catch(() => 'No ticket link');

        const images = await detailPage.$$eval('.left .link a', links => links.map(link => link.href)).catch(() => []);

        eventData.push({
          title,
          date_and_time: dateAndTime,
          host,
          price,
          ticket_link: ticketLink,
          images,
          ended: false,
          free: false,
          venue: "Kyoto Kanze",
        });

        console.log('Extracted paid event data:', title);

        await detailPage.close();
      }
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }

  await browser.close();

  // Filter out events with default values before saving and returning
  const filteredEvents = eventData.filter(event => {
    return (
      event.title !== "No title" &&
      event.date_and_time !== "No date and time" &&
      event.host !== "No host" &&
      event.price !== "No price" &&
      event.ticket_link !== "No ticket link"
    );
  });

  fs.writeFileSync('kyoto_kanze_data.json', JSON.stringify(filteredEvents, null, 2));
  console.log('Data saved to kyoto_kanze_data.json');
  return filteredEvents;
};

export default scrapeKyotoKanze;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const data = await scrapeKyotoKanze();
    console.log('Scraped Data:', data);
  })();
}
