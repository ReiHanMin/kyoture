<template>
  <div>
    <!-- Dropdown to select site -->
    <select v-model="site">
      <option value="" disabled>Select a site to scrape</option>
      <option value="rohm_theatre">Rohm Theatre</option>
      <option value="kyoto_concert_hall">Kyoto Concert Hall</option>
    </select>
    
    <!-- Button to trigger scraping -->
    <button @click="scrapeSite">Scrape</button>

    <!-- Display loading message -->
    <div v-if="loading">Scraping...</div>

    <!-- Display scraped data -->
    <div v-if="scrapedData">
      <h3>Scraped Data:</h3>
      <ul>
        <li v-for="(data, index) in scrapedData" :key="index">
          {{ data.title }} - {{ data.date }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  data() {
    return {
      site: '', // Selected site
      loading: false,
      scrapedData: null
    };
  },
  methods: {
    // Method to start scraping
    scrapeSite() {
      if (!this.site) {
        alert('Please select a site');
        return;
      }

      this.loading = true;
      // Axios call to the backend
      axios.post('/api/scrape', { site: this.site })
        .then(response => {
          this.scrapedData = response.data.data; // Display the scraped data
        })
        .catch(error => {
          // Improved error handling
          if (error.response && error.response.data) {
            alert('Error: ' + error.response.data.message);
          } else {
            alert('An error occurred. Please try again.');
          }
          console.error('Error:', error.response ? error.response.data : error.message);
        })
        .finally(() => {
          this.loading = false; // Stop loading after request is complete
        });
    }
  }
}
</script>
