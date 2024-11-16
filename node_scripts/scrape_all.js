import 'dotenv/config'; // Load environment variables
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import 'dotenv/config';
import scrapeKyotoConcertHall from './kyoto_concert_hall.js';
import scrapeRohmTheatre from './rohm_theatre.js'; // Import the Rohm Theatre scraper
import scrapeKyotoKanze from './kyoto_kanze.js';
import scrapeWaondo from './waondo.js';
import scrapeKyotoGattaca from './kyoto_gattaca.js';

// Define the backend URL using APP_URL from .env
const backendUrl = process.env.APP_URL || 'http://localhost:8000';

// Handle __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useMockData = false; // Set to true for mock data testing

// Array of scraper functions and their identifiers
const scrapers = [
  { name: 'kyoto_concert_hall', func: scrapeKyotoConcertHall },
  // { name: 'rohm_theatre', func: scrapeRohmTheatre },
  // { name: 'kyoto_kanze', func: scrapeKyotoKanze },
  // { name: 'waondo', func: scrapeWaondo },
  // { name: 'kyoto_gattaca', func: scrapeKyotoGattaca },
];

// Function to send data with retry logic
async function sendDataWithRetry(url, payload, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000, // Optional: adjust timeout as needed
      });
      return response; // Return the response if successful
    } catch (error) {
      if (error.code === 'ECONNRESET' && i < retries - 1) {
        console.log(`Connection reset. Retrying... Attempt ${i + 1}`);
        await new Promise(res => setTimeout(res, delay)); // Wait before retrying
      } else {
        console.error(`Failed to send data: ${error.message}`);
        if (i === retries - 1) throw error; // Throw error on the final attempt
      }
    }
  }
}

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
      const response = await sendDataWithRetry(`${backendUrl}/api/scrape`, payload);
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

        // Send the site's data to the backend with retry logic
        const response = await sendDataWithRetry(`${backendUrl}/api/scrape`, payload);
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
