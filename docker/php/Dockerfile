# PHP-FPM image for Moodle 5.2 / 5.3 LTS (PHP 8.3 is the minimum for 5.3)
FROM php:8.3-fpm-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev libjpeg62-turbo-dev libfreetype6-dev \
        libicu-dev libzip-dev libxml2-dev ghostscript unzip \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" gd intl zip soap exif opcache mysqli \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY moodle.ini /usr/local/etc/php/conf.d/zz-moodle.ini
COPY fpm-pool.conf /usr/local/etc/php-fpm.d/zz-ekalavya.conf

# Pre-create data dirs so named volumes inherit www-data ownership
RUN mkdir -p /var/www/moodledata /var/www/localcache \
    && chown -R www-data:www-data /var/www/moodledata /var/www/localcache

WORKDIR /var/www/moodle
