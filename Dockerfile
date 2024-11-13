FROM php:8.2-fpm

WORKDIR /app

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Copy the current directory to the working directory
COPY . /app

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Ensure required PHP extensions are installed (optional)
RUN docker-php-ext-install pdo pdo_mysql

EXPOSE 8080

CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
