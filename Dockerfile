# Use the official PHP image with the desired version
FROM php:8.2-cli

# Set the working directory
WORKDIR /app

# Copy the current directory contents into the container
COPY . /app

# Install any required PHP extensions (if needed)
# RUN docker-php-ext-install pdo pdo_mysql

# Expose port 8080
EXPOSE 8080

# Command to run when the container starts
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
