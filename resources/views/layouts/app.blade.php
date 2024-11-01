<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>{{ config('app.name', 'Laravel Event Aggregator Website') }}</title>

    <!-- Scripts -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    <style>
        [x-cloak] {
            display: none !important;
        }
    </style>
</head>
<body class="bg-orange-50">
    <!-- Include the navigation bar -->
    @include('layouts.navigation')

    <!-- Vue App Mounting Point -->
    <div id="app" class="p-5">
        <!-- Slot for dynamic content -->
        {{ $slot }}
    </div>
</body>
</html>
