import { createApp } from 'vue';
import EventApp from '../views/components/EventApp.vue';
import ScrapeComponent from '../views/components/ScrapeComponent.vue';
import EventCard from '../views/components/EventCard.vue'; 
import EventModal from '../views/components/EventModal.vue';
import axios from 'axios';

import Alpine from 'alpinejs';
window.Alpine = Alpine;
Alpine.start();

// Create the Vue app
const app = createApp({
    data() {
        return {
            events: [], // Initialize the events array here
        };
    },
    async mounted() {
        try {
            // Fetch events from the backend API endpoint
            const response = await axios.get('/api/events');
            this.events = response.data;
            console.log('Fetched events:', this.events);
        } catch (error) {
            console.error('Error fetching events:', error);
        }
    },
    compilerOptions: {
        isCustomElement: (tag) => tag.startsWith('x-'),
    },
});

// Register components globally
app.component('event-app', EventApp);
app.component('scrape-component', ScrapeComponent);
app.component('event-card', EventCard);
app.component('event-modal', EventModal);

// Mount the Vue app
app.mount('#app');
