<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\URL;
use Illuminate\Console\Scheduling\Schedule;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if (config('app.env') === 'production') {
            URL::forceScheme('https');
        }

        // Add this only if AppServiceProvider is being used for scheduling
        $this->app->booted(function () {
            $this->app->make(Schedule::class)->command('scraper:run-all')
                ->dailyAt('00:00') // Run daily at midnight
                ->appendOutputTo(storage_path('logs/scraper.log')); // Log the output
        });
    }
}
