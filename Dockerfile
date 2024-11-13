FROM php:8.2-fpm

WORKDIR /app

# Install necessary system dependencies and PHP extensions
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    libzip-dev \
    nodejs \
    npm && \
    docker-php-ext-install zip pdo pdo_mysql && \
    rm -rf /var/lib/apt/lists/*

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Copy package files and install dependencies
COPY package.json package-lock.json /app/
RUN npm install

# Copy the rest of the application files
COPY . /app

# Run the build command to generate the necessary files in public/build
RUN npm run build

# Install PHP dependencies using Composer
RUN composer install --no-dev --optimize-autoloader

# Ensure the build directory is included
COPY public/build /app/public/build

# Expose the application on port 8080
EXPOSE 8080

# Run the PHP built-in server
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
