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

class FabCafeDataTransformer implements DataTransformerInterface
{
    public function transform(array $eventData): ?array
    {
        Log::info('Dispatching job for FabCafe event data', ['event_data' => $eventData]);

        // Dispatch the job, passing the transformer class name
        \App\Jobs\ProcessEventData::dispatch(static::class, $eventData);

        // Return immediately to prevent long processing in the HTTP request
        return null;
    }

    public function processEvent(array $eventData): ?array
    {
        Log::info('Starting transformation process for FabCafe event data', ['event_data' => $eventData]);

        // Set organization to "FabCafe"
        $eventData['organization'] = 'FabCafe';

        // Generate external_id using title, date_start, and event_link
        $title = strtolower(trim($eventData['title']));
        $dateStart = $eventData['date_start'];
        $eventLink = strtolower(trim($eventData['event_link'] ?? ''));

        $uniqueString = "{$title}|{$dateStart}|{$eventLink}";
        $eventData['external_id'] = md5($uniqueString);

        // Log a warning if event_link is missing
        if (empty($eventData['event_link'])) {
            Log::warning('event_link is missing from FabCafe event data.', ['event_data' => $eventData]);
        }

        // Determine if the event is free based on prices
        $eventData['free'] = true; // Default to true

        if (!empty($eventData['prices'])) {
            $allFree = true; // Assume all prices are free unless proven otherwise

            foreach ($eventData['prices'] as $price) {
                if (isset($price['amount']) && $price['amount'] > 0) {
                    $allFree = false; // Found a price above zero, so it's not entirely free
                    break;
                }
            }

            // If any price tier has an amount greater than zero, mark as not free
            $eventData['free'] = !$allFree;
        }

        // Directly process and save the event without OpenAI processing
        $this->processAndSaveEvent($eventData);

        return $eventData;
    }

    public function processAndSaveEvent(array $eventData): void
    {
        Log::info('Processing FabCafe event data for saving', ['event_data' => $eventData]);

        $venueName = $eventData['venue']['name'] ?? 'FabCafe';
        $eventData['venue_id'] = $this->saveVenue($venueName) ?? null;
        Log::info('Venue ID assigned', ['venue_id' => $eventData['venue_id']]);

        if ($this->isValidEventData($eventData)) {
            $existingEvent = Event::where('external_id', $eventData['external_id'])->first();

            if ($existingEvent) {
                $event = $this->updateEvent($existingEvent->id, $eventData);
                Log::info('Existing event updated', ['event_id' => $event->id]);
            } else {
                $event = $this->saveEvent($eventData);
                Log::info('New event created', ['event_id' => $event->id]);
            }

            if (!empty($eventData['event_link'])) {
                $this->saveEventLink($event->id, $eventData['event_link']);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link']]);
            } else {
                Log::info('No event_link provided, skipping saveEventLink call.', ['event_id' => $event->id]);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    public function updateEvent(int $eventId, array $eventData): ?Event
    {
        try {
            Log::info('Updating existing FabCafe event', ['event_id' => $eventId]);

            $event = Event::find($eventId);

            if ($event) {
                $event->update([
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'],
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    'program' => $eventData['program'] ?? null,
                    'sold_out' => $eventData['sold_out'] ?? false,
                    'free' => $eventData['free'] ?? true,
                    // Add other fields as necessary
                ]);

                $this->saveSchedules($event->id, $eventData['schedules'] ?? $eventData['schedules'] ?? []);
                $this->saveCategories($event, $eventData['categories'] ?? []);
                $this->saveTags($event, $eventData['tags'] ?? []);
                $this->saveImages($event, $eventData['image_url'] ?? null, []);
                $this->savePrices($event->id, $eventData['prices'] ?? []);

                return $event;
            } else {
                Log::warning('Event not found for updating', ['event_id' => $eventId]);
            }
        } catch (QueryException $qe) {
            Log::error('Database error while updating event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }

    public function saveEvent(array $eventData): ?Event
    {
        try {
            Log::info('Creating or updating FabCafe event', ['event_data' => $eventData]);

            if (!isset($eventData['external_id'])) {
                Log::warning('External ID missing for event', ['event_data' => $eventData]);
                return null;
            }

            $event = Event::updateOrCreate(
                ['external_id' => $eventData['external_id']],
                [
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'],
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    'program' => $eventData['program'] ?? null,
                    'sold_out' => $eventData['sold_out'] ?? false,
                    'free' => $eventData['free'] ?? true,
                    // Add other fields as necessary
                ]
            );

            Log::info('Event saved successfully', ['event_id' => $event->id]);

            $this->saveSchedules($event->id, $eventData['schedules'] ?? $eventData['schedules'] ?? []);
            $this->saveCategories($event, $eventData['categories'] ?? []);
            $this->saveTags($event, $eventData['tags'] ?? []);
            $this->saveImages($event, $eventData['image_url'] ?? null, []);
            $this->savePrices($event->id, $eventData['prices'] ?? []);

            return $event;
        } catch (QueryException $qe) {
            Log::error('Database error while saving event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }

    public function isValidEventData(array $eventData): bool
    {
        Log::info('Checking type of $eventData', ['type' => gettype($eventData)]);

        if (!is_array($eventData)) {
            Log::error('Expected $eventData to be an array, but it is not.', ['event_data' => $eventData]);
            return false;
        }

        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
            'external_id' => 'required|string',
            'venue_id' => 'required|integer',
        ]);

        if ($validator->fails()) {
            Log::error('Validation failed:', $validator->errors()->all());
            return false;
        }

        return true;
    }

    public function saveVenue(string $venueName): ?int
    {
        if (empty($venueName)) {
            Log::warning('Venue name is empty. Cannot save or retrieve venue.');
            return null;
        }

        $venue = Venue::firstOrCreate(['name' => $venueName]);
        return $venue->id;
    }

    public function saveSchedules(int $eventId, array $schedules)
    {
        foreach ($schedules as $scheduleData) {
            Schedule::updateOrCreate(
                [
                    'event_id' => $eventId,
                    'date' => $scheduleData['date'],
                ],
                [
                    'time_start' => $this->nullIfEmpty($scheduleData['time_start']),
                    'time_end' => $this->nullIfEmpty($scheduleData['time_end']),
                    'special_notes' => $this->nullIfEmpty($scheduleData['special_notes']),
                    'status' => $scheduleData['status'] ?? 'upcoming',
                ]
            );
        }
    }

    public function nullIfEmpty($value)
    {
        return isset($value) && $value !== '' ? $value : null;
    }

    public function saveImages(Event $event, ?string $primaryImageUrl, array $images = []): void
    {
        if ($primaryImageUrl) {
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
        }

        foreach ($images as $imageData) {
            if (!empty($imageData['image_url'])) {
                Image::updateOrCreate(
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

    public function savePrices(int $eventId, array $prices)
    {
        Log::info('Saving prices for event', ['event_id' => $eventId, 'prices' => $prices]);

        foreach ($prices as $priceData) {
            Price::updateOrCreate(
                [
                    'event_id' => $eventId,
                    'price_tier' => $priceData['price_tier'],
                ],
                [
                    'amount' => $this->nullIfEmpty($priceData['amount']),
                    'currency' => $priceData['currency'] ?? 'JPY',
                    'discount_info' => $this->nullIfEmpty($priceData['discount_info']),
                ]
            );
        }
    }

    public function saveCategories(Event $event, array $categories)
    {
        foreach ($categories as $categoryName) {
            $category = Category::updateOrCreate(['name' => $categoryName]);
            $event->categories()->syncWithoutDetaching([$category->id]);
        }
    }

    public function saveTags(Event $event, array $tags)
    {
        foreach ($tags as $tagName) {
            $tag = Tag::firstOrCreate(['name' => $tagName]);
            $event->tags()->syncWithoutDetaching([$tag->id]);
        }
    }

    public function saveEventLink(int $eventId, string $eventLink)
    {
        EventLink::updateOrCreate(
            [
                'event_id' => $eventId,
                'url' => $eventLink,
            ],
            [
                'link_type' => 'official',
            ]
        );
    }
}
