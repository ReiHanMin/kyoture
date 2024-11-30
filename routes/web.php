<?php

use Illuminate\Support\Facades\Route;



Route::get('/debug-env', function () {
    $envPath = base_path('.env');
    $envExists = file_exists($envPath);
    $envContents = $envExists ? file_get_contents($envPath) : 'File does not exist';
    $openaiKey = env('OPENAI_API_KEY', 'Key not found');

    return response()->json([
        'env_exists' => $envExists,
        'env_path' => $envPath,
        'env_contents' => $envContents,
        'openai_key' => $openaiKey,
    ]);
});


Route::get('/', function () {
    return view('welcome');
});

Route::get('/scrape', function () {
    return view('scrape');
});

// Route to render the admin view
Route::get('/admin', function () {
    return view('admin');
});

// Route for the Past Events page
Route::get('/past-events', function () {
    return view('layouts.app'); // Adjust as needed to use the correct layout or main view for your Vue app
});
