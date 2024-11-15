<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

class TruncateTables extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'tables:truncate';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Truncate specified tables without dropping them';

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $this->info('Starting table truncation...');

        // Disable foreign key checks
        Schema::disableForeignKeyConstraints();

        // Truncate tables in the correct order
        DB::table('event_links')->truncate();
        DB::table('images')->truncate();
        DB::table('prices')->truncate();
        DB::table('schedules')->truncate();
        DB::table('event_tags')->truncate();
        DB::table('tags')->truncate();
        DB::table('event_categories')->truncate();
        DB::table('categories')->truncate();
        DB::table('events')->truncate();
        DB::table('venues')->truncate();

        // Re-enable foreign key checks
        Schema::enableForeignKeyConstraints();

        $this->info('All specified tables have been truncated successfully.');

        return 0;
    }
}
