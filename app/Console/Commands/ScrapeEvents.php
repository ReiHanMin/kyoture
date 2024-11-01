<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;
use Symfony\Component\Process\Exception\ProcessFailedException;
use App\Models\Event;
use Illuminate\Support\Facades\Log;

class ScrapeEvents extends Command
{
    protected $signature = 'scrape:events';
    protected $description = 'Scrape events from all configured sites';

    public function handle()
    {
        $siteScripts = [
            'rohm_theatre' => 'rohm_theatre.js',
            'kyoto_concert_hall' => 'kyoto_concert_hall.js',
            // Add other sites here
        ];

        foreach ($siteScripts as $site => $script) {
            $this->info("Scraping $site...");

            $scriptPath = base_path('node_scripts/' . $script);

            if (!file_exists($scriptPath)) {
                $this->error("Script not found for $site at $scriptPath.");
                Log::error("Script not found for $site at $scriptPath.");
                continue;
            }

            $nodePath = 'node'; // Adjust if node is in a different location
            $process = new Process([$nodePath, $scriptPath]);
            $process->setTimeout(300); // Set timeout in seconds

            try {
                $process->mustRun();

                $stdout = $process->getOutput();
                $stderr = $process->getErrorOutput();

                if (!empty($stderr)) {
                    $this->warn("Warnings from $site: " . $stderr);
                    Log::warning("Warnings from $site: " . $stderr);
                }

                $output = json_decode(trim($stdout), true);

                if (is_array($output)) {
                    foreach ($output as $eventData) {
                        if (isset($eventData['title'], $eventData['date'])) {
                            Event::updateOrCreate(
                                ['title' => $eventData['title'], 'date' => $eventData['date']],
                                [
                                    'imageUrl'     => $eventData['imageUrl'] ?? null,
                                    'eventLink'    => $eventData['eventLink'] ?? null,
                                    'status'       => $eventData['status'] ?? null,
                                    'modalContent' => $eventData['modalContent'] ?? null,
                                    // Add any additional fields
                                ]
                            );
                        } else {
                            $this->error("Missing title or date for an event from $site.");
                            Log::error("Missing title or date for an event from $site. Data: " . json_encode($eventData));
                        }
                    }
                    $this->info("Events saved for $site.");
                } else {
                    $this->error("Invalid output format for $site.");
                    Log::error("Invalid output format for $site. Output: " . $stdout);
                }
            } catch (ProcessFailedException $exception) {
                $this->error("Scraping failed for $site: " . $exception->getMessage());
                Log::error("Scraping failed for $site: " . $exception->getMessage());
                continue;
            } catch (\Exception $e) {
                $this->error("An error occurred while scraping $site: " . $e->getMessage());
                Log::error("An error occurred while scraping $site: " . $e->getMessage());
                continue;
            }
        }

        return 0; // Success
    }
}
