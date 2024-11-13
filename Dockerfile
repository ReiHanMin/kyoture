# Use the PHP image as the base
FROM php:8.2-fpm

# Set the working directory
WORKDIR /app

# Copy composer from the official composer image
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    libzip-dev \
    nodejs \
    npm && \
    docker-php-ext-install zip pdo pdo_mysql && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package.json package-lock.json /app/

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . /app

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Build the assets
RUN npm run build

# Expose the application on port 8080
EXPOSE 8080

# Start the application
CMD ["php-fpm"]
