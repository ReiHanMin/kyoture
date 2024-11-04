<template>
  <div class="container mx-auto px-4 py-8">
    <!-- Events Section -->
    <section v-if="events.length" id="event-list" class="custom-grid">
      <div
        v-for="(event, index) in events"
        :key="event.id"
        :class="getCardClass(index)"
        class="bg-white overflow-hidden relative"
      >
        <!-- Render without <a> tag for Kyoto Concert Hall -->
        <div
          v-if="event.organization === 'Kyoto Concert Hall'"
          @click="openModal(event)"
          class="block h-full cursor-pointer"
        >
          <img
            :src="event.images?.[0]?.image_url || 'placeholder.jpg'"
            :alt="event.title"
            class="w-full h-full object-cover"
          />
          <div class="caption-container">
            <span class="caption-type">{{ event.organization }}</span>
            <h3 class="caption-title">{{ event.title }}</h3>
            <p class="caption-date">{{ formatDateRange(event.date_start, event.date_end) }}</p>
          </div>
        </div>

        <!-- Wrap in <a> tag for non-Kyoto Concert Hall events -->
        <a
          v-else
          :href="event.event_links?.[0]?.url || '#'"
          target="_blank"
          class="block h-full"
        >
          <img
            :src="event.images?.[0]?.image_url || 'placeholder.jpg'"
            :alt="event.title"
            class="w-full h-full object-cover"
          />
          <div class="caption-container">
            <span class="caption-type">{{ event.organization }}</span>
            <h3 class="caption-title">{{ event.title }}</h3>
            <p class="caption-date">{{ formatDateRange(event.date_start, event.date_end) }}</p>
          </div>
        </a>
      </div>
    </section>

    <Spinner v-if="loadingMore" />

    <!-- Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white w-11/12 md:w-3/4 lg:w-1/2 p-6 rounded-lg relative">
        <button
          @click="closeModal"
          class="absolute top-2 right-2 text-gray-500 hover:text-gray-800"
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
          <ul>
            <li v-for="price in selectedEvent?.prices" :key="price.id">
              {{ price.price_tier }}: ¥{{ price.amount }}
            </li>
          </ul>
        </div>

        <!-- Display additional images if available -->
        <div class="text-gray-600 mb-4" v-if="selectedEvent?.images?.length > 1">
          <strong>Additional Images:</strong>
          <div>
            <img
              v-for="image in selectedEvent.images.slice(1)"
              :src="image.image_url"
              :alt="image.alt_text || 'Event Image'"
              :key="image.id"
              class="w-full h-32 object-cover mt-2"
            />
          </div>
        </div>

        <!-- Link to ticket purchase page -->
        <a
          :href="selectedEvent?.organization === 'Kyoto Concert Hall' ? 'https://www.kyotoconcerthall.org/en/ticket/' : selectedEvent?.event_link"
          target="_blank"
          class="text-white bg-blue-500 py-2 px-4 rounded"
        >
          Buy Tickets
        </a>
      </div>
    </div>
    

    <div v-else class="text-center">Loading events...</div>
  </div>
</template>

<script>
import axios from 'axios';
import Spinner from './Spinner.vue'; // Import Spinner component

export default {
  data() {
    return {
      events: [],
      showModal: false,
      selectedEvent: null, // Track the selected event for modal
      loadingMore: false, // Track loading state for additional events
      page: 1, // Track current page for infinite loading
    };
  },
  methods: {
    fetchEvents() {
      axios.get('/api/events')
        .then(response => {
          // Sort events by date_start (closest date to today first)
          this.events = response.data.sort((a, b) => {
            const dateA = new Date(a.date_start);
            const dateB = new Date(b.date_start);
            return dateA - dateB;
          });
        })
        .catch(error => console.error('Error fetching events:', error));
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
      return start && end ? `${start} - ${end}` : start || end || 'Date TBA';
    },
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
  width: 100%; height: 100%; object-fit: cover; 
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
  background-color: black; color: white; padding: 2px 6px; font-size: 0.8rem; font-weight: bold; text-transform: uppercase; display: inline-block; margin-bottom: 5px; 
  }

.caption-title { 
  font-size: 1.2rem; font-weight: bold; margin: 0; 
  }

.caption-date { 
  font-size: 1rem; color: #666; margin-top: 0.5rem; 
  }

.fixed {
   position: fixed; 
   }

.inset-0 { 
  top: 0; right: 0; bottom: 0; left: 0; 
  }

.z-50 {
   z-index: 50; 
   }

.bg-opacity-50 { 
  background-color: rgba(0, 0, 0, 0.5); 
  }
</style>
