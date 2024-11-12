import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import scrapeKyotoConcertHall from './kyoto_concert_hall.js';
import scrapeRohmTheatre from './rohm_theatre.js'; // Import the Rohm Theatre scraper
import scrapeKyotoKanze from './kyoto_kanze.js';
import scrapeWaondo from './waondo.js';
import scrapeKyotoGattaca from './kyoto_gattaca.js';


// Handle __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useMockData = false; // Set to true for mock data testing

const scrapeAll = async () => {
  let combinedData = [];
  let sitesScraped = [];

  if (useMockData) {
    console.log('Using mock data...');
    try {
      const mockDataPath = path.join(__dirname, 'mockData.json');
      const rawData = fs.readFileSync(mockDataPath, 'utf-8');
      combinedData = JSON.parse(rawData);
      sitesScraped = ['mock_site'];
      console.log('Loaded mock data:', combinedData);
    } catch (error) {
      console.error('Failed to load mock data:', error);
      return; // Stop execution if mock data loading fails
    }
  } else {
    console.log('Running real scraping...');

     try {
      // Run the Kyoto Concert Hall scraper and combine its results
      const kyotoConcertHallData = await scrapeKyotoConcertHall();
      if (kyotoConcertHallData.length > 0) {
        combinedData.push(...kyotoConcertHallData);
        sitesScraped.push('kyoto_concert_hall');
      }

      // Run the Rohm Theatre scraper and combine its results
      const rohmTheatreData = await scrapeRohmTheatre();
      if (rohmTheatreData.length > 0) {
        combinedData.push(...rohmTheatreData);
        sitesScraped.push('rohm_theatre');
      }

      // Run the Kyoto Kanze scraper and combine its results
      const kyotoKanzeData = await scrapeKyotoKanze();
      if (kyotoKanzeData.length > 0) {
        combinedData.push(...kyotoKanzeData);
        sitesScraped.push('kyoto_kanze');
      }

      // Run the Waondo scraper and combine its results
      const waondoData = await scrapeWaondo();
      if (waondoData.length > 0) {
        combinedData.push(...waondoData);
        sitesScraped.push('waondo');
      }

      // Run the KyotoGattaca scraper and combine its results
      const kyotoGattacaData = await scrapeKyotoGattaca();
      if (kyotoGattacaData.length > 0) {
        combinedData.push(...kyotoGattacaData);
        sitesScraped.push('kyoto_gattaca');
      }

      console.log('Combined data:', combinedData);
      console.log('Sites scraped:', sitesScraped);
    } catch (error) {
      console.error('Failed to scrape data:', error);
      return; // Stop execution if scraping fails
    }
  }

  // Construct the payload with the list of sites scraped
  const payload = {
    site: sitesScraped.join(','), // e.g., 'kyoto_concert_hall,rohm_theatre'
    events: combinedData,
  };

  console.log('Payload:', JSON.stringify(payload, null, 2));

  // Send the data to the backend
  try {
    const response = await axios.post('http://localhost:8000/api/scrape', payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('Data successfully sent to backend:', response.data);
  } catch (error) {
    if (error.response) {
      console.error('Error status:', error.response.status);
      console.error('Error data:', error.response.data);
      console.error('Validation failed:', error.response.data.errors || error.response.data.message);
    } else {
      console.error('Failed to send data to backend:', error.message);
    }
  }
};

// Run the script directly
if (process.argv[1] === __filename) {
  scrapeAll();
}
