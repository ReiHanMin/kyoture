<template>
<Navbar :isPastEventsPage="true" />
  <div class="container mx-auto px-4 py-8">

    <!-- Past Events Section -->
    <section v-if="pastEvents.length" class="custom-grid">
      <div
        v-for="(event, index) in pastEvents"
        :key="event.id"
        :class="['custom-card', 'event-card', 'bg-white', 'overflow-hidden', 'relative', getCardClass(index)]"
      >
        <!-- Render without <a> tag for specific organizations if needed -->
        <div @click="openModal(event)" class="block h-full cursor-pointer">
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
      </div>
    </section>

    <!-- No events message -->
    <div v-else class="text-center text-gray-500">No past events found.</div>

    <!-- Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white w-11/12 md:w-3/4 lg:w-1/2 p-6 rounded-lg relative">
        <button @click="closeModal" class="absolute top-2 right-2 text-gray-500 hover:text-gray-800">
          &times;
        </button>
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
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import Navbar from './Navbar.vue';

export default {
    components: {
        Navbar,
    },
    data() { return {
      pastEvents: [],
      showModal: false,
      selectedEvent: null,
      loading: true // Add a loading state to indicate data fetching
    };
  },
  methods: {
    async fetchPastEvents() {
      try {
        const response = await axios.get('/api/events'); // Replace with your actual endpoint if needed
        const today = new Date();
        this.pastEvents = response.data
          .filter(event => {
            const eventEndDate = new Date(event.date_end);
            return eventEndDate < today; // Filter only past events
          })
          .sort((a, b) => {
            const dateA = new Date(a.date_start);
            const dateB = new Date(b.date_start);
            return dateB - dateA; // Sort by most recent past event first
          });
        this.loading = false;
      } catch (error) {
        console.error('Error fetching past events:', error);
        this.loading = false;
      }
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
    }
  },
  async created() {
    await this.fetchPastEvents();
  }
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
