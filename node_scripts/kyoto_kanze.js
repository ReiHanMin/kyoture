import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';

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
    const visitedLinks = new Set();

    // Select all 'jump_m50' sections (each representing a month and year)
    const jumpSections = await page.$$('.jump_m50');

    for (const section of jumpSections) {
        // Extract the year and month from the 'kouen_month' class inside the 'title' div
        const yearMonthText = await section.$eval('.title .kouen_month', el => el.textContent.trim()).catch(() => '');
        
        let year = '';
        let month = '';
        const match = yearMonthText.match(/(\d{4})年(\d{1,2})月/);
        if (match) {
            year = match[1];
            month = match[2].padStart(2, '0'); // Ensure two digits
        } else {
            console.warn('Year and month not found in text:', yearMonthText);
            continue; // Skip this section if we can't get the year and month
        }

        // Now, within this section, get all the events
        const eventDivs = await section.$$('.link');

        for (const eventDiv of eventDivs) {
            try {
                const innerHTML = await eventDiv.evaluate(el => el.innerHTML);
                const isFreeEvent = innerHTML.includes('<!-- 無料公演 -->');

                if (isFreeEvent) {
                    const title = await eventDiv.$eval('.midashi', el => el.textContent.trim()).catch(() => 'Unnamed Event');
                    const dateAndTime = await eventDiv.$eval('.bl_title', el => el.textContent.trim()).catch(() => '');
                    const date_and_time = `${year}年${dateAndTime}`; // Prepend the year to 'dateAndTime'
                    const host = await eventDiv.$eval('.box p:not(.midashi):nth-of-type(1)', el => el.textContent.trim()).catch(() => '');
                    const price = await eventDiv.$eval('.box:last-of-type p', el => el.textContent.trim()).catch(() => '');

                    // Build event data entry
                    const eventDataEntry = {
                        title,
                        date_and_time,
                        host,
                        price,
                        ticket_link: 'No ticket link available',
                        event_link: 'http://kyoto-kanze.jp/show_info/',
                        images: [],
                        ended: false,
                        free: true,
                        venue: 'Kyoto Kanze',
                        description: 'No description available',
                        site: 'kyoto_kanze',
                    };

                    eventData.push(eventDataEntry);
                    console.log('Extracted free event data:', eventDataEntry);

                } else {
                    // Process paid events as before
                    const eventLinks = await eventDiv.$$eval('a', els => els.map(el => el.href));

                    // Filter the event links
                    const validEventLinks = eventLinks.filter(link => {
                        if (!link) return false;
                        const url = new URL(link);
                        return url.hostname === 'kyoto-kanze.jp' && url.pathname.startsWith('/show_info/');
                    });

                    const eventLink = validEventLinks.length > 0 ? validEventLinks[0] : null;

                    if (!eventLink) {
                        console.warn('No valid event link found for this event.');
                        continue;
                    }

                    if (visitedLinks.has(eventLink)) {
                        console.log(`Skipping already visited detail page: ${eventLink}`);
                        continue;
                    }

                    visitedLinks.add(eventLink);
                    console.log(`Opening detail page for paid event: ${eventLink}`);

                    const detailPage = await browser.newPage();
                    await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    try {
                        const contentBaseHTML = await detailPage.$eval('#content', el => el.innerHTML).catch(() => {
                            console.warn(`#content not found at ${eventLink}`);
                            return '';
                        });

                        if (!contentBaseHTML) {
                            console.error(`Content not found for event: ${eventLink}`);
                            await detailPage.close();
                            continue;
                        }

                        console.log('Extracted contentBase HTML:', contentBaseHTML);

                        eventData.push({
                            event_link: eventLink,
                            content_base_html: contentBaseHTML,
                            free: false,
                            site: 'kyoto_kanze',
                        });
                    } catch (error) {
                        console.error(`Error extracting content from ${eventLink}:`, error);
                    } finally {
                        await detailPage.close();
                        console.log(`Closed detail page for paid event: ${eventLink}`);
                    }
                }
            } catch (error) {
                console.error('Error processing event:', error);
            }
        }
    }

    await browser.close();
    return eventData.map(event => ({ ...event, site: 'kyoto_kanze' }));
};

export default scrapeKyotoKanze;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const data = await scrapeKyotoKanze();
    console.log('Scraped Data:', data);
  })();
}
