<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class RunScrapeAll extends Command
{
    protected $signature = 'scraper:run-all';
    protected $description = 'Run the scrape_all.js script';

    public function handle()
    {
        Log::info('RunScrapeAll command is running');

        // Path to the node_scripts directory
        $nodeScriptsPath = base_path('node_scripts');

        // Use the full path to the node binary if necessary
        $nodePath = '/usr/local/bin/node'; // Update this path if node is located elsewhere
        // Alternatively, you can use 'which node' to find the path

        // Build the command, ensuring both stdout and stderr are captured
        $command = "cd $nodeScriptsPath && $nodePath scrape_all.js 2>&1";

        Log::info('Executing command', ['command' => $command]);

        // Execute the command and capture the output
        $output = shell_exec($command);

        if ($output === null) {
            Log::error('Failed to execute scrape_all.js script.');
            $this->error('Failed to execute scrape_all.js script.');
        } else {
            Log::info('scrape_all.js output:', ['output' => $output]);
            // Display output in the console
            $this->info($output);
        }
    }
}
