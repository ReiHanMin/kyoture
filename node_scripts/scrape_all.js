import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import scrapeKyotoConcertHall from './kyoto_concert_hall.js';
import scrapeRohmTheatre from './rohm_theatre.js'; // Import the Rohm Theatre scraper
import scrapeKyotoKanze from './kyoto_kanze.js';
import scrapeWaondo from './waondo.js';
import scrapeKyotoGattaca from './kyoto_gattaca.js';

// Define the backend URL
const backendUrl = 'http://192.241.139.60'; // Replace this with the actual URL if needed

// Handle __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useMockData = false; // Set to true for mock data testing

// Array of scraper functions and their identifiers
const scrapers = [
  { name: 'kyoto_concert_hall', func: scrapeKyotoConcertHall },
  { name: 'rohm_theatre', func: scrapeRohmTheatre },
  { name: 'kyoto_kanze', func: scrapeKyotoKanze },
  { name: 'waondo', func: scrapeWaondo },
  { name: 'kyoto_gattaca', func: scrapeKyotoGattaca },
];

const scrapeAll = async () => {
  if (useMockData) {
    console.log('Using mock data...');
    try {
      const mockDataPath = path.join(__dirname, 'mockData.json');
      const rawData = fs.readFileSync(mockDataPath, 'utf-8');
      const combinedData = JSON.parse(rawData);
      const payload = {
        site: 'mock_site',
        events: combinedData,
      };
      console.log('Payload:', JSON.stringify(payload, null, 2));

      // Send mock data to the backend
      const response = await axios.post(`${backendUrl}/api/scrape`, payload, {
        headers: { 'Content-Type': 'application/json' },
      });
      console.log('Mock data successfully sent to backend:', response.data);
    } catch (error) {
      console.error('Failed to load or send mock data:', error);
    }
    return;
  }

  console.log('Running real scraping...');

  for (const scraper of scrapers) {
    console.log(`Scraping site: ${scraper.name}`);
    try {
      const siteData = await scraper.func();
      if (siteData.length > 0) {
        const payload = {
          site: scraper.name,
          events: siteData,
        };
        console.log(`Payload for ${scraper.name}:`, JSON.stringify(payload, null, 2));

        // Send the site's data to the backend
        const response = await axios.post(`${backendUrl}/api/scrape`, payload, {
          headers: { 'Content-Type': 'application/json' },
        });
        console.log(`Data for ${scraper.name} successfully sent to backend:`, response.data);
      } else {
        console.log(`No data scraped for site: ${scraper.name}`);
      }
    } catch (error) {
      if (error.response) {
        console.error(`Error sending data for ${scraper.name}:`, {
          status: error.response.status,
          data: error.response.data,
        });
      } else {
        console.error(`Failed to scrape or send data for ${scraper.name}:`, error.message);
      }
      // Optionally, decide whether to continue with the next scraper or halt
      continue;
    }
  }

  console.log('All scraping tasks completed.');
};

// Run the script directly
if (process.argv[1] === __filename) {
  scrapeAll();
}
