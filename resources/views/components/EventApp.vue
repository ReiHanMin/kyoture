<template>
  <div class="container mx-auto px-4 py-8">
    <!-- Include Navbar -->
    <Navbar @set-selections="setCategories" :isPastEventsPage="false" />

    <!-- Render Past Events Component -->
    <past-events v-if="showPastEvents" :events="events" />

    <!-- Events Section for Current/Upcoming Events -->
    <section v-else-if="filteredEvents.length" id="event-list" class="custom-grid">
      <div
        v-for="(event, index) in filteredEvents"
        :key="event.id"
        :class="['custom-card', 'event-card', 'bg-white', 'overflow-hidden', 'relative', getCardClass(index)]"
      >
        <!-- Render without <a> tag for Kyoto Concert Hall -->
        <div
          v-if="event.organization === 'Kyoto Concert Hall'"
          @click="openModal(event)"
          class="event-wrapper cursor-pointer"
        >
          <div class="event-image">
            <img
              :src="event.images?.[0]?.image_url || 'placeholder.jpg'"
              :alt="event.title"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="event-details">
            <div class="caption-container">
              <span class="caption-type">{{ event.organization }}</span>
              <h3 class="caption-title">{{ event.title }}</h3>
              <p class="caption-date">{{ formatDateRange(event.date_start, event.date_end) }}</p>
            </div>
          </div>
        </div>

        <!-- Wrap in <a> tag for non-Kyoto Concert Hall events -->
        <a
          v-else
          :href="event.event_links?.[0]?.url || '#'"
          target="_blank"
          class="event-wrapper"
        >
          <div class="event-image">
            <img
              :src="event.images?.[0]?.image_url || 'placeholder.jpg'"
              :alt="event.title"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="event-details">
            <div class="caption-container">
              <span class="caption-type">{{ event.organization }}</span>
              <h3 class="caption-title">{{ event.title }}</h3>
              <p class="caption-date">{{ formatDateRange(event.date_start, event.date_end) }}</p>
            </div>
          </div>
        </a>
      </div>
    </section>

    <!-- No events message -->
    <div v-else-if="!filteredEvents.length && !loadingMore" class="text-center text-gray-500">
      No events found!
    </div>

    <!-- Loading Spinner -->
    <Spinner v-if="loadingMore" />

    <!-- Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white w-11/12 md:w-3/4 lg:w-1/2 p-6 rounded-lg relative overflow-auto max-h-screen">
        <button
          @click="closeModal"
          class="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-2xl font-bold"
        >
          &times;
        </button>

        <!-- Display event details in modal -->
        <h3 class="text-2xl font-bold mb-4">{{ selectedEvent?.title }}</h3>
        <p class="text-gray-600 mb-2">
          <strong>Date:</strong> {{ formatDateRange(selectedEvent?.date_start, selectedEvent?.date_end) }}
        </p>
        <p class="text-gray-600 mb-2">
          <strong>Venue:</strong> {{ selectedEvent?.venue?.name }}
        </p>
        <p class="text-gray-600 mb-4">
          <strong>Description:</strong> {{ selectedEvent?.description }}
        </p>

        <!-- Display prices if available -->
        <div class="text-gray-600 mb-4" v-if="selectedEvent?.prices?.length">
          <strong>Prices:</strong>
          <ul class="list-disc list-inside">
            <li v-for="price in selectedEvent?.prices" :key="price.id">
              {{ price.price_tier }}: ¥{{ price.amount }}
            </li>
          </ul>
        </div>

        <!-- Display additional images if available -->
        <div class="text-gray-600 mb-4" v-if="selectedEvent?.images?.length > 1">
          <strong>Additional Images:</strong>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <img
              v-for="image in selectedEvent.images.slice(1)"
              :src="image.image_url"
              :alt="image.alt_text || 'Event Image'"
              :key="image.id"
              class="w-full h-auto object-cover rounded"
            />
          </div>
        </div>

        <!-- Link to ticket purchase page -->
        <a
          :href="selectedEvent?.organization === 'Kyoto Concert Hall' ? 'https://www.kyotoconcerthall.org/en/ticket/' : selectedEvent?.event_link"
          target="_blank"
          class="inline-block mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Buy Tickets
        </a>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import Spinner from './Spinner.vue'; // Import Spinner component
import Navbar from './Navbar.vue';
import PastEvents from './PastEvents.vue'; // Import PastEvents component

export default {
  components: {
    Navbar,
    Spinner,
    PastEvents, // Register PastEvents component
  },
  data() {
    return {
      events: [],
      showPastEvents: false, // Toggle for showing past events
      showModal: false,
      selectedEvent: null,
      loadingMore: false,
      page: 1,
      selectedFilters: {
        type: [],
        price: [],
        date: [],
        location: [],
        customDateRange: { start: null, end: null },
      },
    };
  },
  computed: {
    filteredEvents() {
      const currentDate = this.getCurrentDate(); // Get the current date
      const currentDateObj = new Date(currentDate);

      return this.events.filter(event => {
        const eventStartDate = new Date(event.date_start);
        const eventEndDate = new Date(event.date_end);

        // Type Filtering
        const matchesType = this.selectedFilters.type.length
          ? event.categories.some(category => this.selectedFilters.type.includes(category.name))
          : true;

        // Price Filtering
        const matchesPrice = Array.isArray(this.selectedFilters.price) && this.selectedFilters.price.length
          ? this.selectedFilters.price.some(selectedPrice => {
              if (selectedPrice === 'Free') {
                // Check if all price tiers are zero or there is only a free ticket available
                return event.prices.every(price => parseFloat(price.amount) === 0);
              } else if (selectedPrice === 'Under 1000 Yen') {
                return event.prices.some(price => parseFloat(price.amount) < 1000);
              } else if (selectedPrice === '1000 - 3000 Yen') {
                return event.prices.some(price => parseFloat(price.amount) >= 1000 && parseFloat(price.amount) <= 3000);
              } else if (selectedPrice === '3000 - 5000 Yen') {
                return event.prices.some(price => parseFloat(price.amount) > 3000 && parseFloat(price.amount) <= 5000);
              } else if (selectedPrice === '5000+ Yen') {
                return event.prices.some(price => parseFloat(price.amount) >= 5000);
              }
              return false;
            })
          : true;

        // Date Filtering (includes multiple selections and 'This Weekend')
        const matchesDate = (this.selectedFilters.customDateRange?.start && this.selectedFilters.customDateRange?.end)
          ? eventStartDate >= new Date(this.selectedFilters.customDateRange.start) &&
            eventEndDate <= new Date(this.selectedFilters.customDateRange.end)
          : (!this.selectedFilters.date.length || this.selectedFilters.date.some(selectedDate => {
              if (selectedDate === 'Today') {
                return eventStartDate.toDateString() === currentDateObj.toDateString();
              } else if (selectedDate === 'Tomorrow') {
                const tomorrow = new Date(currentDateObj.getTime() + (24 * 60 * 60 * 1000));
                return eventStartDate.toDateString() === tomorrow.toDateString();
              } else if (selectedDate === 'This Week') {
                const weekEnd = new Date(currentDateObj);
                weekEnd.setDate(currentDateObj.getDate() + (7 - currentDateObj.getDay()));
                return eventStartDate >= currentDateObj && eventStartDate <= weekEnd;
              } else if (selectedDate === 'This Weekend') {
                const saturday = new Date(currentDateObj);
                saturday.setDate(currentDateObj.getDate() + (6 - currentDateObj.getDay()));
                const sunday = new Date(saturday);
                sunday.setDate(saturday.getDate() + 1);
                return eventStartDate >= saturday && eventStartDate <= sunday;
              } else if (selectedDate === 'Next Week') {
                const nextWeekStart = new Date(currentDateObj);
                nextWeekStart.setDate(currentDateObj.getDate() + (7 - currentDateObj.getDay()) + 1);
                const nextWeekEnd = new Date(nextWeekStart);
                nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
                return eventStartDate >= nextWeekStart && eventStartDate <= nextWeekEnd;
              }
              return false;
            }));

        // Location Filtering
        const matchesLocation = this.selectedFilters.location.length
          ? this.selectedFilters.location.includes(event.venue?.name)
          : true;

        return matchesType && matchesPrice && matchesDate && matchesLocation;
      });
    },
  },
  methods: {
    togglePastEvents() {
      this.showPastEvents = !this.showPastEvents;
    },
    getCurrentDate() {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    
    parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day); // Months are 0-indexed
  },

  /**
   * Generates the current date in "YYYY-MM-DD" format.
   * @returns {string} - The current date as a string.
   */
  getCurrentDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Fetches events from the API and categorizes them into current and past events.
   */
  fetchEvents() {
    this.loadingMore = true;
    axios.get('/api/events')
      .then(response => {
        const currentDateStr = this.getCurrentDate(); // e.g., "2024-12-14"
        const currentDate = this.parseDate(currentDateStr);
        currentDate.setHours(0, 0, 0, 0); // Normalize to start of the day
        console.log(`Current Date: ${currentDateStr}`);

        // Preprocess events to handle missing date_end by assigning date_start to date_end
        const processedEvents = response.data.map(event => {
          if (!event.date_end || event.date_end === 'NULL') { // Handle 'NULL' as well
            console.warn(`Missing date_end for event: "${event.title}". Setting date_end to date_start.`);
            return { ...event, date_end: event.date_start };
          }
          return event;
        }).filter(event => event !== null); // Exclude any null events if necessary

        // Log processed events for debugging
        console.log('Processed Events:', processedEvents);

        // Filter events to include all ongoing and upcoming events
        this.events = processedEvents
          .filter(event => {
            const eventEndDate = this.parseDate(event.date_end);
            eventEndDate.setHours(0, 0, 0, 0); // Normalize to start of the day

            if (isNaN(eventEndDate)) {
              console.warn(`Invalid date_end for event: "${event.title}". Excluding from current events.`);
              return false; // Exclude events with invalid date_end
            }

            const isIncluded = eventEndDate >= currentDate;
            console.log(`Event: "${event.title}", End Date: ${event.date_end}, Included: ${isIncluded}`);
            return isIncluded;
          })
          .sort((a, b) => {
            const dateA = this.parseDate(a.date_start);
            const dateB = this.parseDate(b.date_start);
            return dateA - dateB;
          });

        // Separate past events for the past events page
        this.pastEvents = processedEvents
          .filter(event => {
            const eventEndDate = this.parseDate(event.date_end);
            eventEndDate.setHours(0, 0, 0, 0); // Normalize to start of the day
            return eventEndDate < currentDate;
          })
          .sort((a, b) => {
            const dateA = this.parseDate(a.date_end);
            const dateB = this.parseDate(b.date_end);
            return dateB - dateA; // Sort past events by most recent first
          });

        this.loadingMore = false;
      })
      .catch(error => {
        console.error('Error fetching events:', error);
        this.loadingMore = false;
      });
  },


    setCategories(filters) {
      console.log(`setCategories method called with: `, filters);
      this.selectedFilters = filters;
    },
    openModal(event) {
      this.selectedEvent = event;
      this.showModal = true;
    },
    closeModal() {
      this.showModal = false;
    },
    getCardClass(index) {
      const row = Math.floor(index / 5);
      const position = index % 5;
      if (row % 2 === 0 && position < 2) {
        return position === 0 ? 'col-span-2 h-96' : 'col-span-1 h-96';
      }
      if (row % 2 === 1 && position < 2) {
        return position === 0 ? 'col-span-1 h-96' : 'col-span-2 h-96';
      }
      if (row % 2 === 0 && position >= 2) {
        return 'col-span-1 h-96';
      }
      return 'col-span-1 h-96';
    },
    formatDateRange(start, end) {
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (startDate.getTime() === endDate.getTime()) {
        // Single-day event
        return startDate.toLocaleDateString('en-GB', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }); // e.g., "15 November 2024"
      } else {
        // Multi-day event
        const options = { day: 'numeric' };

        // Check if start and end dates are in the same month/year
        if (
          startDate.getFullYear() === endDate.getFullYear() &&
          startDate.getMonth() === endDate.getMonth()
        ) {
          return `${startDate.getDate()} - ${endDate.toLocaleDateString('en-GB', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })}`; // e.g., "15 - 16 November, 2024"
        } else {
          return `${startDate.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long'
          })} - ${endDate.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })}`; // e.g., "30 November - 3 December, 2024"
        }
      }
    }
  },
  mounted() {
    this.fetchEvents();
  },
};
</script>

<style scoped>
.custom-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}
.col-span-1 { 
  grid-column: span 1; 
}
.col-span-2 {
  grid-column: span 2; 
}
.h-96 { 
  height: 24rem; 
}
img { 
  width: 100%; 
  height: 100%; 
  object-fit: cover; 
}
.caption-container {
  position: absolute;
  bottom: 0;
  left: 0;
  padding: 3px;
  width: auto;
  background-color: rgba(255, 255, 255, 1);
  margin: 10px;
}
.caption-type { 
  background-color: black; 
  color: white; 
  padding: 2px 6px; 
  font-size: 0.8rem; 
  font-weight: bold; 
  text-transform: uppercase; 
  display: inline-block; 
  margin-bottom: 5px; 
}
.caption-title { 
  font-size: 1.2rem; 
  font-weight: bold; 
  margin: 0; 
}
.caption-date { 
  font-size: 1rem; 
  color: #666; 
  margin-top: 0.5rem; 
}
.fixed {
  position: fixed; 
}
.inset-0 { 
  top: 0; 
  right: 0; 
  bottom: 0; 
  left: 0; 
}
.z-50 {
  z-index: 50; 
}
.bg-opacity-50 { 
  background-color: rgba(0, 0, 0, 0.5); 
}

@media (max-width: 480px) {
  .custom-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .event-card {
    border-radius: 0.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    height: 120px; /* Adjust the height as needed */
    overflow: hidden;
  }

  /* Apply flex to both <a> and <div> wrappers inside .event-card */
  .event-wrapper {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 100%;
    text-decoration: none; /* Remove underline for <a> */
    width: 100%;
  }

  .event-image {
    flex: 0 0 33%; /* Ensures the image takes one-third of the width */
    max-width: 33%; /* Reinforces the width constraint */
    height: 100%; /* Matches the card's height */
    border-radius: 0.5rem 0 0 0.5rem; /* Rounded corners on the left */
    overflow: hidden;
  }

  .event-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .event-details {
    flex: 1; /* Ensures the text section takes up the remaining space */
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden; /* Prevents text overflow */
    min-width: 0; /* Allows the flex item to shrink properly */
  }

  .caption-container {
    position: static; /* Remove absolute positioning */
    background-color: transparent;
    margin: 0;
    white-space: nowrap; /* Prevents text from wrapping */
    overflow: hidden; /* Hides overflowing text */
    text-overflow: ellipsis; /* Adds ellipsis for overflowing text */
    padding: 0; /* Remove padding */
  }

  .caption-type { 
    background-color: black; 
    color: white; 
    padding: 2px 6px; 
    font-size: 0.8rem; 
    font-weight: bold; 
    text-transform: uppercase; 
    display: inline-block; 
    margin-bottom: 5px; 
  }
  .caption-title { 
    font-size: 1.2rem; 
    font-weight: bold; 
    margin: 0; 
    flex-shrink: 1;
  }
  .caption-date { 
    font-size: 1rem; 
    color: #666; 
    margin-top: 0.5rem; 
    flex-shrink: 0;
  }
}
</style>
