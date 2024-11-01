<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>{{ config('app.name', 'Kyoture Event App') }}</title>

    <!-- Alpine.js -->
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.10.5/dist/cdn.min.js" defer></script>

    <!-- Vite Scripts -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])

    <!-- Custom Style -->
    <style>
        [x-cloak] {
            display: none !important;
        }
    </style>
</head>
<body class="bg-white">
    <!-- Include the Navigation -->
    @include('layouts.navigation')

    <!-- Main Content -->
    <main class="p-5">
        {{ $slot }}
    </main>
</body>
</html>
