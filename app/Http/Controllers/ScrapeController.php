<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Services\DataTransformers\DataTransformerFactory;

class ScrapeController extends Controller
{
    public function scrape(Request $request)
    {
        Log::info('Scrape method triggered. Received request:', $request->all());

        // Validate the incoming request and log if validation fails
        try {
            $request->validate([
                'site' => 'required|string',
                'events' => 'required|array',
            ]);
        } catch (\Illuminate\Validation\ValidationException $e) {
            Log::error('Validation failed', ['errors' => $e->errors()]);
            return response()->json(['error' => 'Validation failed', 'details' => $e->errors()], 400);
        }

        $site = trim($request->input('site'));
        $events = $request->input('events');

        Log::info('Processing site', ['site' => $site]);
        Log::info('Number of events received', ['count' => count($events)]);

        // Instantiate the appropriate data transformer
        $transformer = DataTransformerFactory::make($site);

        if (!$transformer) {
            Log::warning('Unsupported site detected', ['site' => $site]);
            return response()->json(['error' => 'Unsupported site: ' . $site], 400);
        }

        $processed = false;

        // Process each event with the transformer
        foreach ($events as $eventData) {
            try {
                Log::info('Processing event for site', ['site' => $site, 'title' => $eventData['title'] ?? 'Unnamed Event']);
                $transformer->transform($eventData);
                Log::info('Event processed successfully', ['site' => $site, 'title' => $eventData['title'] ?? 'Unnamed Event']);
                $processed = true;
            } catch (\Exception $e) {
                Log::error('Failed to process event', [
                    'site' => $site,
                    'error' => $e->getMessage(),
                    'event_data' => $eventData
                ]);
                // Optionally, decide whether to continue processing other events or halt
                // For example, to continue:
                continue;
                // Or to halt:
                // break;
            }
        }

        if (!$processed) {
            return response()->json(['error' => 'No events processed. Issues occurred during processing.'], 400);
        }

        Log::info('All events processed successfully for site', ['site' => $site]);

        return response()->json([
            'success' => true,
            'message' => 'Events processed and saved successfully for site: ' . $site,
        ]);
    }
}
