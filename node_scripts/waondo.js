import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Use the stealth plugin to evade detection
puppeteer.use(StealthPlugin());

const scrapeWaondo = async () => {
  // Launch Puppeteer with necessary options
  const browser = await puppeteer.launch({
    headless: true, // Run in headless mode
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necessary for some environments
  });

  const page = await browser.newPage();

  // Set a realistic user agent to mimic a real browser
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)');

  // Navigate to the target URL with appropriate wait conditions
  await page.goto('https://www.waondo.net/%E3%83%A9%E3%82%A4%E3%83%96%E3%82%B9%E3%82%B1%E3%82%B8%E3%83%A5%E3%83%BC%E3%83%AB', {
    waitUntil: 'networkidle0', // Wait until there are no more than 0 network connections for at least 500 ms
    timeout: 60000, // Maximum navigation time of 60 seconds
  });

  console.log('Page loaded.');

  // **Debugging Step 1: Take a Screenshot**
  await page.screenshot({ path: 'waondo_page.png', fullPage: true });
  console.log('Screenshot saved as waondo_page.png');

  // **Debugging Step 2: List All `wow-image` Elements on the Page**
  const allWowImages = await page.evaluate(() => {
    // Recursive function to traverse the DOM, including shadow roots
    function getAllWowImages(node, wowImages = []) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName.toLowerCase() === 'wow-image') {
          wowImages.push(node);
        }
        // Traverse child nodes
        node.childNodes.forEach(child => getAllWowImages(child, wowImages));
        // Traverse shadow DOM if present
        if (node.shadowRoot) {
          node.shadowRoot.childNodes.forEach(child => getAllWowImages(child, wowImages));
        }
      }
      return wowImages;
    }

    // Start traversal from the body
    const wowImages = getAllWowImages(document.body);

    // Extract relevant details from each `wow-image` element
    return wowImages.map((el, index) => {
      const imageInfo = el.getAttribute('data-image-info');
      const img = el.querySelector('img');
      const imgSrc = img ? (img.src || img.getAttribute('data-src') || 'No img src') : 'No img element';
      const alt = img ? (img.alt || 'No alt attribute').trim() : 'No img element'; // Trimmed alt
      return {
        index,
        imageInfo,
        imgSrc,
        alt,
        outerHTML: el.outerHTML,
      };
    });
  });

  console.log(`Number of 'wow-image' elements found on the page: ${allWowImages.length}`);
  if (allWowImages.length > 0) {
    console.log('Sample wow-image element:', allWowImages[0]);
  } else {
    console.log('No wow-image elements found on the page.');
  }

  // **Debugging Step 3: List All `div[data-hook="image"]` Elements**
  const imageDivs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div[data-hook="image"]')).map((el, index) => ({
      index,
      outerHTML: el.outerHTML,
    }));
  });

  console.log(`Number of 'div[data-hook="image"]' elements found: ${imageDivs.length}`);
  if (imageDivs.length > 0) {
    console.log('Sample image div:', imageDivs[0]);
  } else {
    console.log('No div[data-hook="image"] elements found on the page.');
  }

  // **Debugging Step 4: Extract and Save `eventDiv` OuterHTML**
  const eventsHtml = await page.evaluate(() => {
    const events = Array.from(document.querySelectorAll('div.j2Owzh.Wprg5l[data-hook="content"]'));
    return events.map((eventDiv, index) => ({
      index,
      outerHTML: eventDiv.outerHTML,
    }));
  });

  console.log(`Number of eventDivs found: ${eventsHtml.length}`);
  if (eventsHtml.length > 0) {
    console.log('First event div outerHTML:', eventsHtml[0].outerHTML.substring(0, 500) + '...'); // Log first 500 chars for brevity
  } else {
    console.log('No eventDiv elements found on the page.');
  }

  // Save eventsHtml to a file for manual inspection
  fs.writeFileSync('waondo_events_html.json', JSON.stringify(eventsHtml, null, 2));
  console.log('Events HTML saved to waondo_events_html.json');

  // **Proceed with Event Data Extraction and Image Mapping**
  const eventData = await page.evaluate(() => {
    // Extract all events
    const eventDivs = Array.from(document.querySelectorAll('div.j2Owzh.Wprg5l[data-hook="content"]'));
    const events = eventDivs.map(eventDiv => {
      const titleElement = eventDiv.querySelector('div[data-hook="title"] a');
      const title = titleElement ? titleElement.textContent.trim() : 'No title';
      const dateElement = eventDiv.querySelector('div[data-hook="date"]');
      const date = dateElement ? dateElement.textContent.trim() : 'No date';
      const locationElement = eventDiv.querySelector('div[data-hook="location"]');
      const location = locationElement ? locationElement.textContent.trim() : 'No location';
      const descriptionElement = eventDiv.querySelector('div[data-hook="description"]');
      const description = descriptionElement ? descriptionElement.textContent.trim() : 'No description';
      const event_link = titleElement ? titleElement.href : 'No link';
      const priceMatch = description.match(/【料金】(.+)/);
      const price = priceMatch ? priceMatch[1].trim() : 'No price information';

      return { title, date, location, description, event_link, price };
    });

    // Extract all images
    const imageDivs = Array.from(document.querySelectorAll('wow-image'));
    const images = imageDivs.map(imgDiv => {
      const img = imgDiv.querySelector('img');
      const alt = img ? (img.alt || 'No alt attribute').trim() : 'No img element'; // Trimmed alt
      const src = img ? (img.src || img.getAttribute('data-src') || 'No img src') : 'No img element';
      return { alt, src };
    });

    // Create a map of trimmed image alt (lowercased) to src for case-insensitive matching
    const imageMap = {};
    images.forEach(image => {
      const trimmedAlt = image.alt.trim().toLowerCase();
      if (trimmedAlt !== 'no alt attribute' && trimmedAlt !== 'no img element') {
        imageMap[trimmedAlt] = image.src;
      }
    });

    // Map images to events based on title matching alt attribute (both trimmed and lowercased)
    const mappedEvents = events.map(event => {
      const normalizedTitle = event.title.trim().toLowerCase();
      const image_url = imageMap[normalizedTitle] || 'No image available';
      return { ...event, image_url, site: 'waondo' };
    });

    return mappedEvents;
  });

  // Log the extracted event data to check the output
  console.log('Extracted event data:', eventData);

  // Save the data to a JSON file
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
