<template>
  <div class="card">
    <!-- Conditional rendering based on organization -->
    <template v-if="isKyotoConcertHall">
      <div @click="openModal" class="block h-full cursor-pointer">
        <img :src="imageUrl" :alt="title" class="w-full h-48 object-cover" />
        <div class="caption-container p-4">
          <span class="caption-type">{{ organization }}</span>
          <h3 class="caption-title">{{ title }}</h3>
          <p class="caption-date">{{ date }}</p>
        </div>
      </div>
    </template>
    <template v-else>
      <a
        :href="link"
        target="_blank"
        class="block h-full cursor-pointer"
      >
        <img :src="imageUrl" :alt="title" class="w-full h-48 object-cover" />
        <div class="caption-container p-4">
          <span class="caption-type">{{ organization }}</span>
          <h3 class="caption-title">{{ title }}</h3>
          <p class="caption-date">{{ date }}</p>
        </div>
      </a>
    </template>

    <!-- Modal -->
    <div
      v-if="showModal && isKyotoConcertHall"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white w-11/12 md:w-3/4 lg:w-1/2 p-6 rounded-lg relative">
        <button
          @click="closeModal"
          class="absolute top-2 right-2 text-gray-500 hover:text-gray-800"
        >
          &times;
        </button>

        <!-- Event Details -->
        <h3 class="text-2xl font-bold mb-4">{{ title }}</h3>
        <p class="text-gray-600 mb-2"><strong>Date:</strong> {{ date }}</p>
        <p class="text-gray-600 mb-2"><strong>Venue:</strong> {{ venue }}</p>
        <p class="text-gray-600 mb-4"><strong>Program:</strong> {{ program }}</p>
        <p class="text-gray-600 mb-4"><strong>Price:</strong> {{ price }}</p>
        <p class="text-gray-600 mb-4">
          <strong>Release Date:</strong> {{ releaseDate }}
        </p>

        <!-- Link to ticket purchase page -->
        <a
          :href="link"
          target="_blank"
          class="text-white bg-blue-500 py-2 px-4 rounded"
        >
          Buy Tickets
        </a>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    title: String,
    date: String,
    imageUrl: String,
    link: String,
    status: String,
    modalContent: String,
    venue: String,
    program: String,
    price: String,
    releaseDate: String,
    organization: String,
  },
  data() {
    return {
      showModal: false,
    };
  },
  computed: {
    isKyotoConcertHall() {
      return this.organization === 'Kyoto Concert Hall';
    },
  },
  methods: {
    openModal() {
      this.showModal = true;
    },
    closeModal() {
      this.showModal = false;
    },
  },
  mounted() {
    console.log('Organization prop in EventCard:', this.organization);
  },
};
</script>
