<?php

namespace App\Services\DataTransformers;

use App\Models\Event;
use App\Models\Venue;
use App\Models\Price;
use App\Models\Image;
use App\Models\Category;
use App\Models\Tag;
use App\Models\Schedule;
use App\Models\EventLink;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Database\QueryException;

class KyotoKanzeDataTransformer implements DataTransformerInterface
{
    public function transform(array $eventData): ?array
    {
        Log::info('Starting transformation process for Kyoto Kanze event data', ['event_data' => $eventData]);

        // Prepare data transformation using OpenAI or custom parsing logic
        $prompt = $this->constructPrompt($eventData);
        $responseData = $this->callOpenAI($prompt);

        if (!empty($responseData) && isset($responseData['events'])) {
            Log::info('OpenAI response received', ['response_data' => $responseData]);

            foreach ($responseData['events'] as &$processedEvent) {
                // Append the original description
                $processedEvent['description'] = $eventData['description'];
                $this->processAndSaveEvent($processedEvent);
            }

            return $responseData;
        }

        Log::warning('API response is empty or malformed.', ['response' => $responseData]);
        return null;
    }

    private function processAndSaveEvent(array $eventData): void
    {
        Log::info('Processing event data for Kyoto Kanze', ['event_data' => $eventData]);

        $eventData['external_id'] = md5("{$eventData['title']}_{$eventData['date_start']}_{$eventData['venue']}");
        $eventData['venue_id'] = $this->saveVenue($eventData['venue']) ?? null;

        if ($this->isValidEventData($eventData)) {
            $existingEvent = Event::where('external_id', $eventData['external_id'])->first();

            if ($existingEvent) {
                $event = $this->updateEvent($existingEvent->id, $eventData);
                Log::info('Existing event updated', ['event_id' => $event->id]);
            } else {
                $event = $this->saveEvent($eventData);
                Log::info('New event created', ['event_id' => $event->id]);
            }

            if ($event) {
                $this->saveEventLink($event->id, $eventData['event_link']);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link']]);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    private function updateEvent(int $eventId, array $eventData): ?Event
    {
        try {
            Log::info('Updating existing event for Kyoto Kanze', ['event_id' => $eventId]);

            $event = Event::find($eventId);
            if ($event) {
                $event->update([
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'] ?? null,
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    'program' => $eventData['program'] ?? null,
                    'sold_out' => $eventData['sold_out'] ?? false,
                ]);

                $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
                $this->saveCategories($event, $eventData['categories'] ?? []);
                $this->saveTags($event, $eventData['tags'] ?? []);
                $this->saveImages($event, $eventData['image_url'] ?? null, []);
                $this->savePrices($event->id, $eventData['prices'] ?? []);

                return $event;
            } else {
                Log::warning('Event not found for updating', ['event_id' => $eventId]);
            }
        } catch (QueryException $qe) {
            Log::error('Database error while updating Kyoto Kanze event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }

    private function constructPrompt(array $eventData): string
    {
        $jsonEventData = json_encode($eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $prompt = <<<EOT
        Transform the provided Kyoto Kanze event data into JSON format with these fields:
        1. Parse 'raw_date' into 'date_start' and 'date_end' (YYYY-MM-DD).
        2. Create a 'schedule' array with 'date', 'time_start', 'time_end', 'special_notes' from 'raw_date' or 'raw_schedule'.
        3. Assign categories and tags based on keywords.
        4. Extract 'prices' as [{ "price_tier": "", "amount": "", "currency": "JPY" }].

        Event Data: {$jsonEventData}
        EOT;
        Log::info('Constructed prompt for Kyoto Kanze', ['prompt' => $prompt]);
        return $prompt;
    }

    // Define additional helper methods like saveSchedules, saveVenue, saveEventLink, etc.
}


// Save schedules to the database
private function saveSchedules(int $eventId, array $schedules): void
{
    foreach ($schedules as $scheduleData) {
        Schedule::updateOrCreate(
            [
                'event_id' => $eventId,
                'date' => $scheduleData['date'],
                'time_start' => $this->nullIfEmpty($scheduleData['time_start']),
                'time_end' => $this->nullIfEmpty($scheduleData['time_end']),
                'special_notes' => $this->nullIfEmpty($scheduleData['special_notes']),
            ]
        );
    }
}

// Save the venue to the database or retrieve it if it already exists
private function saveVenue(string $venueName): ?int
{
    if (empty($venueName)) {
        return null;
    }

    $venue = Venue::firstOrCreate(['name' => $venueName]);
    return $venue->id;
}

// Save event link
private function saveEventLink(int $eventId, string $eventLink): void
{
    EventLink::updateOrCreate(
        [
            'event_id' => $eventId,
            'url' => $eventLink,
        ],
        [
            'link_type' => 'primary' // Set link type as needed
        ]
    );
}

// Save categories to the database and associate them with the event
private function saveCategories(Event $event, array $categories): void
{
    foreach ($categories as $categoryName) {
        $category = Category::firstOrCreate(['name' => $categoryName]);
        $event->categories()->syncWithoutDetaching([$category->id]);
    }
}

// Save tags to the database and associate them with the event
private function saveTags(Event $event, array $tags): void
{
    foreach ($tags as $tagName) {
        $tag = Tag::firstOrCreate(['name' => $tagName]);
        $event->tags()->syncWithoutDetaching([$tag->id]);
    }
}

// Save images to the database, using a stock image for free events if no image is provided
    private function saveImages(Event $event, ?string $primaryImageUrl, array $images = []): void
    {
        // Use the provided stock image URL if no primary image URL is available
        $primaryImageUrl = $primaryImageUrl ?? 'http://kyoto-kanze.jp/images/top002.jpg';

        // Save the primary image (either the actual or the stock image)
        Image::updateOrCreate(
            [
                'event_id' => $event->id,
                'image_url' => $primaryImageUrl,
            ],
            [
                'alt_text' => 'Main Event Image',
                'is_featured' => true,
            ]
        );

        // Save additional images if provided
        foreach ($images as $imageUrl) {
            if (!empty($imageUrl)) {
                Image::updateOrCreate(
                    [
                        'event_id' => $event->id,
                        'image_url' => $imageUrl,
                    ],
                    [
                        'alt_text' => 'Additional Event Image',
                        'is_featured' => false,
                    ]
                );
            }
        }
    }


// Save prices to the database
private function savePrices(int $eventId, array $prices): void
{
    foreach ($prices as $priceData) {
        Price::updateOrCreate(
            [
                'event_id' => $eventId,
                'price_tier' => $priceData['price_tier'],
            ],
            [
                'amount' => $priceData['amount'],
                'currency' => $priceData['currency'] ?? 'JPY',
                'discount_info' => $this->nullIfEmpty($priceData['discount_info']),
            ]
        );
    }
}

// Helper function to handle null values for empty strings
private function nullIfEmpty($value)
{
    return !empty($value) ? $value : null;
}
