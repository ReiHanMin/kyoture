<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});
Route::get('/scrape', function () {return view('scrape');});
// Route to render the admin view
Route::get('/admin', function () {
    return view('admin');
});
