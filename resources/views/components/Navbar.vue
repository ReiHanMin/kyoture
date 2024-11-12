<template>
  <nav class="bg-white p-4">
    <div class="container mx-auto">
      <!-- Navbar Title -->
      <div class="text-center">
        <a href="/" class="text-4xl font-extrabold text-gray-800 tracking-widest font-sans hover:text-blue-500 transition-colors duration-300">
          kyoture
        </a>
      </div>
      <div class="container mx-auto flex justify-center mt-8">
        <div class="flex space-x-4">
          <!-- Type Dropdown -->
          <div class="relative inline-block text-left" ref="typeDropdown">
            <button @click="toggleDropdown('type')" class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none">
              Type ▼
            </button>
            <div v-if="openDropdown === 'type'" class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
              <a href="#" v-for="option in typeOptions" :key="option" @click.prevent="toggleSelection(option, 'type')" class="block px-4 py-2 text-black hover:bg-gray-200">
                {{ option }}
              </a>
            </div>
          </div>

          <!-- Price Dropdown -->
          <div class="relative inline-block text-left" ref="priceDropdown">
            <button @click="toggleDropdown('price')" class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none">
              Price ▼
            </button>
            <div v-if="openDropdown === 'price'" class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
              <a href="#" v-for="option in priceOptions" :key="option" @click.prevent="toggleSelection(option, 'price')" class="block px-4 py-2 text-black hover:bg-gray-200">
                {{ option }}
              </a>
            </div>
          </div>

            <!-- Date Dropdown -->
          <div class="relative inline-block text-left" ref="dateDropdown">
            <button @click="toggleDropdown('date')" class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none">
              Date ▼
            </button>
            <div v-if="openDropdown === 'date'" class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
              <a href="#" v-for="option in dateOptions" :key="option" @click.prevent="toggleSelection(option, 'date')" class="block px-4 py-2 text-black hover:bg-gray-200">
                {{ option }}
              </a>
              <!-- Custom Date Selection -->
              <div class="px-4 py-2">
                <label class="block text-gray-700">From:</label>
                <input type="date" v-model="customDateRange.start" class="border rounded px-2 py-1 w-full">
                <label class="block text-gray-700 mt-2">To:</label>
                <input type="date" v-model="customDateRange.end" class="border rounded px-2 py-1 w-full">
                <button @click.prevent="applyCustomDateRange" class="mt-2 text-blue-500 hover:text-blue-700">Apply Custom Date</button>
              </div>
            </div>
          </div>

          <!-- Location Dropdown -->
          <div class="relative inline-block text-left" ref="locationDropdown">
            <button @click="toggleDropdown('location')" class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none">
              Location ▼
            </button>
            <div v-if="openDropdown === 'location'" class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
              <a href="#" v-for="option in locationOptions" :key="option" @click.prevent="toggleSelection(option, 'location')" class="block px-4 py-2 text-black hover:bg-gray-200">
                {{ option }}
              </a>
            </div>
          </div>
        </div>
        <!-- Past Events Button -->
        <!-- Past Events -->
                        <button
                        @click="navigateToPastEvents"
                        class="text-black hover:text-gray-700 px-4 py-2 rounded-lg"
                        >
                        {{ isPastEventsPage ? 'Upcoming Events' : 'Past Events' }}
                        </button>
      </div>

      
      <!-- Selected Filters -->
<div class="flex flex-wrap space-x-2 mt-4">
  <!-- Type selections -->
  <div v-if="selectedType.length" class="flex flex-wrap space-x-2">
    <span v-for="type in selectedType" :key="type" class="bg-gray-200 px-3 py-1 rounded-full flex items-center">
      {{ type }}
      <button @click="removeSelection(type, 'type')" class="ml-2 text-gray-500 hover:text-black">×</button>
    </span>
  </div>

  <!-- Price selections -->
  <div v-if="selectedPrice.length" class="flex flex-wrap space-x-2">
    <span v-for="price in selectedPrice" :key="price" class="bg-gray-200 px-3 py-1 rounded-full flex items-center">
      {{ price }}
      <button @click="removeSelection(price, 'price')" class="ml-2 text-gray-500 hover:text-black">×</button>
    </span>
  </div>

<!-- Add this block within the Selected Filters div -->
<div v-if="customDateRange.start && customDateRange.end">
  <span class="bg-gray-200 px-3 py-1 rounded-full flex items-center">
    {{ customDateRange.start }} - {{ customDateRange.end }}
    <button @click="clearCustomDateRange" class="ml-2 text-gray-500 hover:text-black">×</button>
  </span>
</div>


  <!-- Location selections -->
  <div v-if="selectedLocation.length" class="flex flex-wrap space-x-2">
    <span v-for="location in selectedLocation" :key="location" class="bg-gray-200 px-3 py-1 rounded-full flex items-center">
      {{ location }}
      <button @click="removeSelection(location, 'location')" class="ml-2 text-gray-500 hover:text-black">×</button>
    </span>
  </div>

  <!-- Display Date Selections -->
<div v-if="selectedDate.length">
  <span v-for="date in selectedDate" :key="date" class="bg-gray-200 px-3 py-1 rounded-full flex items-center">
    {{ date }}
    <button @click="removeSelection(date, 'date')" class="ml-2 text-gray-500 hover:text-black">×</button>
  </span>
</div>


  <!-- Clear All Button -->
  <button v-if="anySelected" @click="clearAllSelections" class="text-red-500 font-semibold ml-4">Clear All</button>
</div>

    </div>
  </nav>
</template>

<script>
export default {
  props: {
    isPastEventsPage: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      openDropdown: null,
      selectedType: [],
      selectedPrice: [],
      selectedDate: [],
      selectedLocation: [],
      customDateRange: {
      start: null,
      end: null,
    },
      typeOptions: ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Tour', 'Festival', 'Family', 'Wellness', 'Sports'],
      priceOptions: ['Free', 'Under 1000 Yen', '1000 - 3000 Yen', '3000 - 5000 Yen', '5000+ Yen'],
      dateOptions: ['Today', 'Tomorrow', 'This Week', 'This Weekend', 'Next Week'],
      locationOptions: ['Kyoto Station Area', 'Gion', 'Arashiyama', 'Fushimi Inari', 'Higashiyama'],
    };
  },
  computed: {
    anySelected() {
      return this.selectedType.length || this.selectedPrice.length || this.selectedDate.length || this.selectedLocation.length;
    },
  },
  methods: {
    toggleDropdown(dropdown) {
      this.openDropdown = this.openDropdown === dropdown ? null : dropdown;
    },
    closeDropdown() {
      this.openDropdown = null;
    },
    toggleSelection(option, type) {
    let selectedArray;
    switch (type) {
      case 'type':
        selectedArray = this.selectedType;
        break;
      case 'price':
        selectedArray = this.selectedPrice;
        break;
      case 'date':
        selectedArray = this.selectedDate;
        break;
      case 'location':
        selectedArray = this.selectedLocation;
        break;
    }

    if (type === 'date') {
      // Ensure only one date can be selected at a time
      this.selectedDate = [option];
      this.customDateRange = { start: null, end: null };
    } else {
      if (selectedArray.includes(option)) {
        selectedArray.splice(selectedArray.indexOf(option), 1);
      } else {
        selectedArray.push(option);
      }
    }
    console.log(`Selected ${type}:`, selectedArray);
    this.$emit('set-selections', {
      type: this.selectedType,
      price: this.selectedPrice,
      date: this.selectedDate,
      location: this.selectedLocation,
      customDateRange: this.customDateRange,
    });
    this.closeDropdown();
    },
        removeSelection(option, type) {
      let selectedArray;
      switch (type) {
        case 'type':
          selectedArray = this.selectedType;
          break;
        case 'price':
          selectedArray = this.selectedPrice;
          break;
        case 'date':
          selectedArray = this.selectedDate;
          this.customDateRange = { start: null, end: null }; // Clear custom date range
          break;
        case 'location':
          selectedArray = this.selectedLocation;
          break;
      }

      selectedArray.splice(selectedArray.indexOf(option), 1);
      console.log(`Removed ${type}: ${option}`);
      this.$emit('set-selections', {
        type: this.selectedType,
        price: this.selectedPrice,
        date: this.selectedDate,
        location: this.selectedLocation,
        customDateRange: this.customDateRange, // Ensure it is passed
      });
    },

    clearAllSelections() {
      this.selectedType = [];
      this.selectedPrice = [];
      this.selectedDate = [];
      this.selectedLocation = [];
      this.customDateRange = { start: null, end: null }; // Reset custom date range
      console.log('Cleared all selections');
      this.$emit('set-selections', {
        type: this.selectedType,
        price: this.selectedPrice,
        date: this.selectedDate,
        location: this.selectedLocation,
        customDateRange: this.customDateRange, // Ensure it is passed
      });
    },
    handleClickOutside(event) {
      if (
        !this.$refs.typeDropdown.contains(event.target) &&
        !this.$refs.priceDropdown.contains(event.target) &&
        !this.$refs.dateDropdown.contains(event.target) &&
        !this.$refs.locationDropdown.contains(event.target)
      ) {
        this.closeDropdown();
      }
    },
    navigateToPastEvents() {
      if (this.isPastEventsPage) {
        // Navigate to the upcoming events page (the main event page)
        window.location.href = '/';
      } else {
        // Navigate to the past events page
        window.location.href = '/past-events';
      }
    },
    applyCustomDateRange() {
    if (this.customDateRange.start && this.customDateRange.end) {
      this.selectedDate = []; // Clear existing date selection to prioritize custom range
      console.log('Applying custom date range:', this.customDateRange);
      this.$emit('set-selections', {
        type: this.selectedType,
        price: this.selectedPrice,
        date: this.selectedDate,
        location: this.selectedLocation,
        customDateRange: this.customDateRange, // Include custom date range
      });
      this.closeDropdown(); // Close the dropdown after applying
    }
  },
  clearCustomDateRange() {
    this.customDateRange = { start: null, end: null };
    this.$emit('set-selections', {
      type: this.selectedType,
      price: this.selectedPrice,
      date: this.selectedDate,
      location: this.selectedLocation,
      customDateRange: this.customDateRange,
    });
  },
  },
  mounted() {
    document.addEventListener('click', this.handleClickOutside);
  },
  beforeUnmount() {
  document.removeEventListener('click', this.handleClickOutside);
},
};
</script>
