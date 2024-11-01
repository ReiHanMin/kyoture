import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import scrapeRohmTheatre from './rohm_theatre.js';

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
      // Run the Rohm Theatre scraper and combine its results
      const rohmTheatreData = await scrapeRohmTheatre();
      if (rohmTheatreData.length > 0) {
        combinedData.push(...rohmTheatreData);
        sitesScraped.push('rohm_theatre');
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
    site: sitesScraped.join(','), // e.g., 'rohm_theatre'
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
