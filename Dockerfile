FROM php:8.2-fpm

WORKDIR /app

# Install system dependencies and PHP extensions
RUN apt-get update && apt-get install -y \
    git \
    unzip \
    libzip-dev && \
    docker-php-ext-install zip pdo pdo_mysql && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js and npm
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Copy the app files
COPY . .

# Install PHP and Node.js dependencies
RUN composer install --no-dev --optimize-autoloader && npm install && npm run build

EXPOSE 8080

CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
