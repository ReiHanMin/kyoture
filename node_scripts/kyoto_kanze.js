import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toHalfWidth = (str) => str.replace(/[！-～]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
).replace(/　/g, ' ');

const scrapeKyotoKanze = async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)');
    await page.goto('http://kyoto-kanze.jp/show_info/', { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(3000); // Wait for 3 seconds after initial load to ensure everything is fully rendered

    console.log('Main page loaded.');

    const eventData = [];
    const visitedLinks = new Set();

    const jumpSections = await page.$$('.jump_m50');

    for (const section of jumpSections) {
        const yearMonthText = await section.$eval('.title .kouen_month', el => el.textContent.trim()).catch(() => '');

        let year = '';
        let month = '';
        const match = yearMonthText.match(/(\d{4})年(\d{1,2})月/);
        if (match) {
            year = match[1];
            month = match[2].padStart(2, '0');
        } else {
            console.warn('Year and month not found in text:', yearMonthText);
            continue;
        }

        const eventDivs = await section.$$('.link');

        for (const eventDiv of eventDivs) {
            try {
                const innerHTML = await eventDiv.evaluate(el => el.innerHTML);
                const isFreeEvent = innerHTML.includes('<!-- 無料公演 -->');

                const title = await eventDiv.$eval('.midashi', el => el.textContent.trim()).catch(() => 'Unnamed Event');
                const dateAndTime = toHalfWidth(await eventDiv.$eval('.bl_title', el => el.textContent.trim()).catch(() => ''));
                const host = await eventDiv.$eval('.box p:not(.midashi):nth-of-type(1)', el => el.textContent.trim()).catch(() => '');
                const priceText = await eventDiv.$eval('.box:last-of-type p', el => el.textContent.trim()).catch(() => 'No price');

                // Parse date and time
                let date_start, date_end, time_start = null, time_end = null;
                const dateRegex = /(\d{1,2})月(\d{1,2})日/;
                const dateMatch = dateRegex.exec(dateAndTime);

                if (dateMatch) {
                    const day = dateMatch[2].padStart(2, '0');
                    date_start = `${year}-${month}-${day}`;
                    date_end = date_start; // Set date_end to date_start if end date is not provided

                    // Extract time if present
                    const timeRegex = /(\d{1,2}:\d{2})/g;
                    const timeMatches = dateAndTime.match(timeRegex);
                    if (timeMatches) {
                        time_start = timeMatches[0];
                        time_end = timeMatches[1] || null;
                    }
                } else {
                    console.error('Date not found in dateAndTime:', dateAndTime);
                    continue;
                }

                // Parse prices
                const prices = [];
                if (priceText.includes('無料')) {
                    prices.push({ price_tier: 'Free', amount: '0', currency: 'JPY' });
                } else {
                    const priceMatches = priceText.match(/￥?([\d,]+)/g);
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

                // Extract images
                const imageUrl = await eventDiv.$eval('img', img => img.src).catch(() => null);

                const eventDataEntry = {
                    title,
                    date_start,
                    date_end,
                    venue: 'Kyoto Kanze',
                    organization: 'Kyoto Kanze',
                    image_url: imageUrl || 'http://kyoto-kanze.jp/images/top002.jpg',
                    schedule: [
                        {
                            date: date_start,
                            time_start,
                            time_end,
                            special_notes: null
                        }
                    ],
                    prices,
                    host,
                    event_link: 'http://kyoto-kanze.jp/show_info/',
                    content_base_html: innerHTML,
                    description: 'No description available',
                    categories: [],
                    tags: [],
                    ended: false,
                    free: isFreeEvent,
                    site: 'kyoto_kanze'
                };

                if (!isFreeEvent) {
                    const eventLinks = await eventDiv.$$eval('a', els => els.map(el => el.href));
                    const validEventLinks = eventLinks.filter(link => {
                        if (!link) return false;
                        const url = new URL(link);
                        return url.hostname === 'kyoto-kanze.jp' && url.pathname.startsWith('/show_info/');
                    });

                    const eventLink = validEventLinks.length > 0 ? validEventLinks[0] : null;
                    if (eventLink && !visitedLinks.has(eventLink)) {
                        visitedLinks.add(eventLink);
                        console.log(`Opening detail page for paid event: ${eventLink}`);

                        const detailPage = await browser.newPage();
                        await detailPage.goto(eventLink, { waitUntil: 'domcontentloaded', timeout: 60000 });

                        // Delay to slow down the process and avoid being blocked
                        await delay(3000); // Wait for 3 seconds to ensure the page has fully loaded

                        try {
                            const contentBaseHTML = await detailPage.$eval('#content', el => el.innerHTML).catch(() => '');
                            const detailImageUrl = await detailPage.$eval('.left img', img => img.src).catch(() => null);

                            if (contentBaseHTML) {
                                eventDataEntry.event_link = eventLink;
                                eventDataEntry.content_base_html = contentBaseHTML;
                                eventDataEntry.image_url = detailImageUrl || eventDataEntry.image_url;
                                eventDataEntry.free = false;
                                console.log('Extracted paid event data:', eventDataEntry);
                            } else {
                                console.error(`Content not found for event: ${eventLink}`);
                            }
                        } catch (error) {
                            console.error(`Error extracting content from ${eventLink}:`, error);
                        } finally {
                            await detailPage.close();
                            // Optional delay after closing the page
                            await delay(1000); // Wait for 1 second before continuing
                        }
                    }
                }

                eventData.push(eventDataEntry);
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
