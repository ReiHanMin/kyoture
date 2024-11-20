<?php

namespace App\Jobs;

use App\Services\DataTransformers\DataTransformerInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\Log;

class ProcessEventData implements ShouldQueue
{
    use Dispatchable, Queueable;

    protected $transformerClass;
    protected $eventData;

    public function __construct(string $transformerClass, array $eventData)
    {
        $this->transformerClass = $transformerClass;
        $this->eventData = $eventData;
    }

    public function handle()
{
    try {
        Log::info('Job started for processing event', ['title' => $this->eventData['title'] ?? 'Unnamed Event']);

        // Instantiate the transformer
        $transformer = new $this->transformerClass();

        // Call the transformer's processEvent method
        $transformer->processEvent($this->eventData);

        Log::info('Job completed for event', ['title' => $this->eventData['title'] ?? 'Unnamed Event']);
    } catch (\Exception $e) {
        Log::error('Failed to process event in job', [
            'error' => $e->getMessage(),
            'event_data' => $this->eventData,
            'trace' => $e->getTraceAsString(),
        ]);
    }
}

}