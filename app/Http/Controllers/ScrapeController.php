<?php

namespace App\Http\Controllers;

use App\Services\DataTransformers\DataTransformerFactory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

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

    $sites = explode(',', $request->input('site')); // Split the site names
    $events = $request->input('events');

    Log::info('Sites extracted', ['sites' => $sites]);
    Log::info('Number of events received', ['count' => count($events)]);

    $processed = false;

    foreach ($sites as $site) {
        $site = trim($site); // Clean up any extra spaces

        // Instantiate the appropriate data transformer
        $transformer = DataTransformerFactory::make($site);

        if (!$transformer) {
            Log::warning('Unsupported site detected', ['site' => $site]);
            continue; // Skip unsupported sites
        }

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
            }
        }
    }

    if (!$processed) {
        return response()->json(['error' => 'No events processed. Unsupported sites or other issues occurred.'], 400);
    }

    Log::info('All events processed successfully for sites', ['sites' => $sites]);

    return response()->json([
        'success' => true,
        'message' => 'Events processed and saved successfully!',
    ]);
}

}
