<nav class="bg-white p-4" x-data="{ openDropdown: null }">
    <div class="container mx-auto">
        <!-- Navbar Title -->
        <div class="text-center">
            <a href="/" class="text-4xl font-extrabold text-gray-800 tracking-widest font-sans hover:text-blue-500 transition-colors duration-300">
                kyoture
            </a>
        </div>
            <div class="container mx-auto flex justify-center mt-8">
                <!-- Manage a single state variable for dropdowns -->
                <div x-data="{ openDropdown: null }" class="flex space-x-4">
        
                    <!-- Type Dropdown -->
                    <div class="relative inline-block text-left">
                        <button 
                            @click="openDropdown = openDropdown === 'type' ? null : 'type'" 
                            class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none"
                        >
                            Type ▼
                        </button>
                        <div 
                            x-show="openDropdown === 'type'" 
                            x-transition 
                            x-cloak 
                            class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                            style="display: none;"
                        >
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Festivals</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Music</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Exhibitions</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Workshops</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Remove Filter</a>
                        </div>
                    </div>
        
                    <!-- Price Dropdown -->
                    <div class="relative inline-block text-left">
                        <button 
                            @click="openDropdown = openDropdown === 'price' ? null : 'price'" 
                            class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none"
                        >
                            Price ▼
                        </button>
                        <div 
                            x-show="openDropdown === 'price'" 
                            x-transition 
                            x-cloak 
                            class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                            style="display: none;"
                        >
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Free</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Under 1000 Yen</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">1000 - 3000 Yen</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">3000 - 5000 Yen</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">5000+ Yen</a>
                        </div>
                    </div>
        
                    <!-- Date Dropdown -->
                    <div class="relative inline-block text-left">
                        <button 
                            @click="openDropdown = openDropdown === 'date' ? null : 'date'" 
                            class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none"
                        >
                            Date ▼
                        </button>
                        <div 
                            x-show="openDropdown === 'date'" 
                            x-transition 
                            x-cloak 
                            class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                            style="display: none;"
                        >
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Today</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Tomorrow</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">This Week</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">This Weekend</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Next Week</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Custom Range...</a>
                        </div>
                    </div>
        
                    <!-- Location Dropdown -->
                    <div class="relative inline-block text-left">
                        <button 
                            @click="openDropdown = openDropdown === 'location' ? null : 'location'" 
                            class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none"
                        >
                            Location ▼
                        </button>
                        <div 
                            x-show="openDropdown === 'location'" 
                            x-transition 
                            x-cloak 
                            class="absolute mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                            style="display: none;"
                        >
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Kyoto Station Area</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Gion</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Arashiyama</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Fushimi Inari</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Higashiyama</a>
                            <a href="#" class="block px-4 py-2 text-black hover:bg-gray-200">Remove Filter</a>
                        </div>
                    </div>
        
                    <!-- Remove All Filters -->
                    <button class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none">
                        Remove Filter
                    </button>
        
                    <!-- Past Events -->
                    <button class="text-black hover:text-gray-700 px-4 py-2 rounded-lg focus:outline-none">
                        Past Events
                    </button>
                </div>
            </div>      
    </div>
</nav>
