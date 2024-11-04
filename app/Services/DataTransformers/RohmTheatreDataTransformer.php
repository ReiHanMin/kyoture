<?php

namespace App\Services\DataTransformers;

use App\Models\Event;
use App\Models\Venue;
use App\Models\Price;
use App\Models\Category;
use App\Models\Tag;
use App\Models\Schedule;
use App\Models\Image;
use App\Models\EventLink;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Validator;

class RohmTheatreDataTransformer implements DataTransformerInterface
{
    public function transform(array $eventData): ?array
    {
        Log::info('Starting transformation process for event data', ['event_data' => $eventData]);

        $prompt = $this->constructPrompt($eventData);
        Log::info('Constructed OpenAI prompt', ['prompt' => $prompt]);

        $responseData = $this->callOpenAI($prompt);

        if (!empty($responseData) && isset($responseData['events'])) {
            Log::info('OpenAI response received', ['response_data' => $responseData]);

            foreach ($responseData['events'] as &$processedEvent) {
                $processedEvent['description'] = $eventData['description'] ?? null;
                $processedEvent['organization'] = $eventData['organization'] ?? null;
            }
            unset($processedEvent);

            foreach ($responseData['events'] as $processedEvent) {
                $this->processAndSaveEvent($processedEvent);
            }
            return $responseData;
        }

        Log::warning('API response is empty or malformed.', ['response' => $responseData]);
        return null;
    }

    private function constructPrompt(array $eventData): string
    {
        // Prompt construction logic here...
        return $prompt;
    }

    private function callOpenAI(string $prompt): ?array
    {
        // Call OpenAI API logic here...
        return null;
    }

    private function processAndSaveEvent(array $eventData): void
    {
        Log::info('Processing event data for saving', ['event_data' => $eventData]);

        $eventData['venue_id'] = $this->saveVenue($eventData) ?? null;
        Log::info('Venue ID assigned', ['venue_id' => $eventData['venue_id']]);

        if ($this->isValidEventData($eventData)) {
            $event = Event::updateOrCreate(
                ['external_id' => $eventData['external_id']],  // Unique identifier
                [
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'] ?? null,
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                ]
            );

            Log::info('Event saved or updated', ['event_id' => $event->id]);

            if ($event) {
                if (!empty($eventData['event_link'])) {
                    $this->saveEventLink($event->id, $eventData['event_link']);
                    Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link']]);
                }
                $this->saveSchedules($event, $eventData['schedule'] ?? []);
                $this->saveCategoriesAndTags($event, $eventData);
                $this->saveImages($event, $eventData['image_url'] ?? null, []);
                $this->savePrices($event, $eventData['prices'] ?? []);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    private function saveVenue(array $eventData): ?int
    {
        // Save or retrieve venue logic here...
        return null;
    }

    private function saveEventLink(int $eventId, string $eventLink): void
    {
        EventLink::updateOrCreate(
            ['event_id' => $eventId, 'url' => $eventLink],
            ['link_type' => 'primary']
        );
    }

    private function isValidEventData(array $eventData): bool
    {
        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
        ]);

        return !$validator->fails();
    }

    private function saveSchedules(Event $event, array $schedules): void
    {
        foreach ($schedules as $schedule) {
            $time_start = $schedule['time_start'] ?? null;
            $time_end = $schedule['time_end'] ?? null;

            Schedule::updateOrCreate(
                [
                    'event_id' => $event->id,
                    'date' => $schedule['date'],
                ],
                [
                    'time_start' => $time_start,
                    'time_end' => $time_end,
                    'special_notes' => $schedule['special_notes'] ?? null,
                ]
            );
        }
    }

    private function saveCategoriesAndTags(Event $event, array $eventData): void
    {
        $categoryIds = [];
        foreach ($eventData['categories'] ?? [] as $categoryName) {
            $category = Category::firstOrCreate(['name' => trim($categoryName)]);
            $categoryIds[] = $category->id;
        }
        $event->categories()->sync($categoryIds);

        $tagIds = [];
        foreach ($eventData['tags'] ?? [] as $tagName) {
            $tag = Tag::firstOrCreate(['name' => trim($tagName)]);
            $tagIds[] = $tag->id;
        }
        $event->tags()->sync($tagIds);
    }

    private function saveImages(Event $event, ?string $primaryImageUrl, array $images): void
    {
        if ($primaryImageUrl) {
            Image::firstOrCreate(
                [
                    'event_id' => $event->id,
                    'image_url' => $primaryImageUrl,
                ],
                [
                    'alt_text' => 'Main Event Image',
                    'is_featured' => true,
                ]
            );
        }

        foreach ($images as $imageData) {
            if (!empty($imageData['image_url'])) {
                Image::firstOrCreate(
                    [
                        'event_id' => $event->id,
                        'image_url' => $imageData['image_url'],
                    ],
                    [
                        'alt_text' => $imageData['alt_text'] ?? 'Additional Event Image',
                        'is_featured' => $imageData['is_featured'] ?? false,
                    ]
                );
            }
        }
    }

    private function savePrices(Event $event, array $prices): void
    {
        foreach ($prices as $priceData) {
            if (!empty($priceData['amount'])) {
                Price::updateOrCreate(
                    [
                        'event_id' => $event->id,
                        'price_tier' => $priceData['price_tier'] ?? 'General',
                    ],
                    [
                        'amount' => $priceData['amount'],
                        'currency' => $priceData['currency'] ?? 'JPY',
                        'discount_info' => $priceData['discount_info'] ?? null,
                    ]
                );
            }
        }
    }
}
