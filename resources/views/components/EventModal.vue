<template>
  <div
    class="card block cursor-pointer h-full"
    @click="handleClick"
  >
    <img :src="imageUrl" :alt="title" class="w-full h-48 object-cover" />
    <div class="caption-container p-4">
      <span class="caption-type">{{ organization }}</span>
      <h3 class="caption-title">{{ title }}</h3>
      <p class="caption-date">{{ date }}</p>
    </div>
  </div>

  <!-- Modal -->
  <div
    v-if="showModal && isKyotoConcertHall"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
  >
    <div class="bg-white w-11/12 md:w-3/4 lg:w-1/2 p-6 rounded-lg relative shadow-lg">
      <button
        @click="closeModal"
        class="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-3xl"
      >
        &times;
      </button>

      <!-- Event Image -->
      <div class="mb-4">
        <img :src="imageUrl" :alt="title" class="w-full h-64 object-cover rounded-md" />
      </div>

      <!-- Event Details -->
      <h3 class="text-2xl font-bold mb-4">{{ title }}</h3>
      <p class="text-gray-600 mb-2"><strong>Date:</strong> {{ date }}</p>
      <p class="text-gray-600 mb-2"><strong>Venue:</strong> {{ venue }}</p>
      <p class="text-gray-600 mb-4"><strong>Program:</strong> {{ program }}</p>

      <!-- Conditional display for Price and Release Date -->
      <p v-if="price" class="text-gray-600 mb-2"><strong>Price:</strong> {{ price }}</p>
      <p v-if="releaseDate" class="text-gray-600 mb-4">
        <strong>Release Date:</strong> {{ releaseDate }}
      </p>

      <!-- Ticket Link -->
      <a
        v-if="link"
        :href="link"
        target="_blank"
        class="text-white bg-blue-500 py-2 px-4 rounded hover:bg-blue-600 transition duration-200"
      >
        Buy Tickets
      </a>
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
    handleClick() {
      if (this.isKyotoConcertHall) {
        this.showModal = true;
      } else {
        window.open(this.link, '_blank');
      }
    },
    closeModal() {
      this.showModal = false;
    },
  },
};
</script>

<style scoped>
.card {
  transition: transform 0.3s;
}
.card:hover {
  transform: scale(1.05);
}
</style>
