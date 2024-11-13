import { createApp, h } from 'vue';
import EventApp from '../views/components/EventApp.vue';
import PastEvents from '../views/components/PastEvents.vue';
import Navbar from '../views/components/Navbar.vue';
import axios from 'axios';
import '../css/app.css';

const app = createApp({
    data() {
        return {
            events: [],
            currentPath: window.location.pathname, // Get the current path
        };
    },
    async mounted() {
        try {
            const response = await axios.get('/api/events');
            this.events = response.data;
            console.log('Fetched events:', this.events);
        } catch (error) {
            console.error('Error fetching events:', error);
        }
    },
    render() {
        if (this.currentPath === '/past-events') {
            return h(PastEvents);
        } else {
            return h(EventApp);
        }
    },
});

// Register other global components if needed
app.component('nav-bar', Navbar);
app.mount('#app');
