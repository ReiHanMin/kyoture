FROM php:8.2-fpm

WORKDIR /app

# Install necessary system dependencies and PHP extensions
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    libzip-dev && \
    docker-php-ext-install zip pdo pdo_mysql && \
    rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Install Node.js and npm (for running Vite)
RUN apt-get install -y nodejs npm

# Set the working directory for npm
WORKDIR /app

# Copy the package.json and package-lock.json (if available) to install dependencies
COPY package.json package-lock.json /app/

# Install npm dependencies (including Vite)
RUN npm install

# Run npm build to generate Vite assets (manifest.json and other build files)
RUN npm run build

# Copy the rest of the application files
COPY . /app

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Ensure the build directory is included
COPY public/build /app/public/build

# Expose the application on port 8080
EXPOSE 8080

# Command to start the PHP server
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
