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

        // Process each event with the transformer
        foreach ($events as $eventData) {
            try {
                Log::info('Dispatching job for event', ['site' => $site, 'title' => $eventData['title'] ?? 'Unnamed Event']);
                $transformer->transform($eventData);
            } catch (\Exception $e) {
                Log::error('Failed to dispatch job for event', [
                    'site' => $site,
                    'error' => $e->getMessage(),
                    'event_data' => $eventData
                ]);
                continue;
            }
        }

        Log::info('All events dispatched for processing for site', ['site' => $site]);

        return response()->json([
            'success' => true,
            'message' => 'Events have been dispatched for processing for site: ' . $site,
        ]);
    }
}


