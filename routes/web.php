<?php

use Illuminate\Support\Facades\Route;



Route::get('/test-env', function () {
    return env('OPENAI_API_KEY') ?? 'Key not found';
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
