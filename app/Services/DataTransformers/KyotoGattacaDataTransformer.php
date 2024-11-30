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
use Illuminate\Support\Facades\Http;
use App\Jobs\ProcessEventData;

class KyotoGattacaDataTransformer implements DataTransformerInterface
{
    /**
     * Dispatches the event data processing job.
     *
     * @param array $eventData
     * @return array|null
     */
    public function transform(array $eventData): ?array
    {
        Log::info('Dispatching job for Kyoto Gattaca event data', ['event_data' => $eventData]);

        // Dispatch the job for async processing, passing the transformer class and event data
        ProcessEventData::dispatch(static::class, $eventData);

        // Return immediately to prevent long processing in the HTTP request
        return null;
    }

    /**
     * Processes the event data by transforming and saving it.
     *
     * @param array $eventData
     * @return void
     */
    public function processEvent(array $eventData): void
    {
        Log::info('Processing event data for Kyoto Gattaca', ['event_data' => $eventData]);

        // Ensure the organization field is set to "Kyoto Gattaca"
        $eventData['organization'] = 'Kyoto Gattaca';

        // Generate a unique external ID
        $eventData['external_id'] = md5("{$eventData['title']}_{$eventData['date_start']}_{$eventData['venue']}");
        Log::info('Generated external ID', ['external_id' => $eventData['external_id']]);

        // Save or get the venue ID
        $eventData['venue_id'] = $this->saveVenue($eventData['venue'] ?? null);
        Log::info('Venue ID', ['venue_id' => $eventData['venue_id']]);

        // Determine if the event is free based on prices
        $eventData['free'] = empty($eventData['prices']);

        if ($this->isValidEventData($eventData)) {
            $existingEvent = Event::where('external_id', $eventData['external_id'])->first();

            if ($existingEvent) {
                Log::info('Event already exists, updating', ['event_id' => $existingEvent->id]);
                $event = $this->updateEvent($existingEvent->id, $eventData);
                Log::info('Existing event updated', ['event_id' => $event->id]);
            } else {
                Log::info('Creating new event');
                $event = $this->saveEvent($eventData);
                Log::info('New event created', ['event_id' => $event->id]);
            }

            if ($event) {
                $this->saveEventLink($event->id, $eventData['event_link'] ?? null);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link'] ?? null]);

                // Save related data
                $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
                $this->saveCategories($event, $eventData['categories'] ?? []);
                $this->saveTags($event, $eventData['tags'] ?? []);
                $this->saveImages($event, $eventData['image_url'] ?? null, [], $eventData['event_link'] ?? null);
                $this->savePrices($event->id, $eventData['prices'] ?? []);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    /**
     * Validates the event data.
     *
     * @param array $eventData
     * @return bool
     */
    public function isValidEventData(array $eventData): bool
    {
        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
            'external_id' => 'required|string',
            'event_link' => 'required|string',
            'venue_id' => 'nullable|integer',
        ]);

        if ($validator->fails()) {
            Log::error('Validation failed', ['errors' => $validator->errors()->all(), 'event_data' => $eventData]);
            return false;
        }

        return true;
    }

    /**
     * Saves a new Kyoto Gattaca event to the database.
     *
     * @param array $eventData
     * @return Event|null
     */
    public function saveEvent(array $eventData): ?Event
    {
        try {
            Log::info('Saving new Kyoto Gattaca event', ['event_data' => $eventData]);

            $event = Event::create([
                'title' => $eventData['title'],
                'organization' => $eventData['organization'] ?? null,
                'description' => $eventData['description'] ?? 'No description available',
                'date_start' => $eventData['date_start'],
                'date_end' => $eventData['date_end'],
                'venue_id' => $eventData['venue_id'] ?? null,
                'external_id' => $eventData['external_id'],
                'free' => $eventData['free'] ?? false,
                'ended' => false, // Assuming events are ongoing; adjust as needed
            ]);

            Log::info('Kyoto Gattaca event saved successfully', ['event_id' => $event->id]);

            // Save related data
            $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
            $this->saveCategories($event, $eventData['categories'] ?? []);
            $this->saveTags($event, $eventData['tags'] ?? []);
            $this->saveImages($event, $eventData['image_url'] ?? null, [], $eventData['event_link'] ?? null);
            $this->savePrices($event->id, $eventData['prices'] ?? []);

            return $event;
        } catch (QueryException $qe) {
            Log::error('Database error while saving Kyoto Gattaca event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        } catch (\Exception $e) {
            Log::error('Unexpected error while saving Kyoto Gattaca event', [
                'error_message' => $e->getMessage(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }

    /**
     * Updates an existing Kyoto Gattaca event in the database.
     *
     * @param int $eventId
     * @param array $eventData
     * @return Event|null
     */
    public function updateEvent(int $eventId, array $eventData): ?Event
    {
        try {
            Log::info('Updating existing event for Kyoto Gattaca', ['event_id' => $eventId]);

            $event = Event::find($eventId);
            if ($event) {
                $event->update([
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'] ?? null,
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    'free' => $eventData['free'] ?? false,
                    // 'external_id' remains unchanged
                    'ended' => $eventData['ended'] ?? $event->ended,
                ]);

                $this->saveSchedules($event, $eventData['schedule'] ?? []);
                $this->saveCategories($event, $eventData['categories'] ?? []);
                $this->saveTags($event, $eventData['tags'] ?? []);
                $this->saveImages($event, $eventData['image_url'] ?? null, [], $eventData['event_link'] ?? null);
                $this->savePrices($event->id, $eventData['prices'] ?? []);

                return $event;
            } else {
                Log::warning('Event not found for updating', ['event_id' => $eventId]);
            }
        } catch (QueryException $qe) {
            Log::error('Database error while updating Kyoto Gattaca event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }

    /**
     * Saves or retrieves a venue based on the provided name.
     *
     * @param string|null $venueName
     * @return int|null
     */
    public function saveVenue(?string $venueName): ?int
    {
        if (empty($venueName)) {
            Log::warning('Venue name is missing; venue data was not saved.');
            return null;
        }

        $venue = Venue::firstOrCreate(['name' => trim($venueName)]);
        Log::info('Venue saved or retrieved', ['venue_id' => $venue->id]);

        return $venue->id;
    }

    /**
     * Saves the event link.
     *
     * @param int $eventId
     * @param string|null $eventLink
     * @return void
     */
    public function saveEventLink(int $eventId, ?string $eventLink): void
    {
        if ($eventLink) {
            EventLink::updateOrCreate(
                [
                    'event_id' => $eventId,
                    'url' => $eventLink,
                ],
                [
                    'link_type' => 'primary' // Set link type as needed
                ]
            );
        } else {
            Log::warning('Event link is missing; skipping EventLink save.', ['event_id' => $eventId]);
        }
    }

    /**
     * Saves categories related to an event.
     *
     * @param Event $event
     * @param array $categories
     * @return void
     */
    public function saveCategories(Event $event, array $categories): void
    {
        foreach ($categories as $categoryName) {
            $category = Category::firstOrCreate(['name' => trim($categoryName)]);
            $event->categories()->syncWithoutDetaching([$category->id]);
        }
    }

    /**
     * Saves tags related to an event.
     *
     * @param Event $event
     * @param array $tags
     * @return void
     */
    public function saveTags(Event $event, array $tags): void
    {
        foreach ($tags as $tagName) {
            $tag = Tag::firstOrCreate(['name' => trim($tagName)]);
            $event->tags()->syncWithoutDetaching([$tag->id]);
        }
    }

    /**
     * Saves images related to an event.
     *
     * @param Event $event
     * @param string|null $primaryImageUrl
     * @param array $images
     * @param string|null $eventLink
     * @return void
     */
    public function saveImages(Event $event, ?string $primaryImageUrl, array $images = [], ?string $eventLink = null): void
    {
        // Use a default placeholder image if no primary image URL is provided
        $defaultImageUrl = '/images/events/placeholder.jpg'; // Ensure this placeholder exists

        $primaryImageUrl = $primaryImageUrl ?: $defaultImageUrl;

        // Save the primary image
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

    /**
     * Saves prices related to an event.
     *
     * @param int $eventId
     * @param array $prices
     * @return void
     */
    public function savePrices(int $eventId, array $prices): void
    {
        foreach ($prices as $priceData) {
            // Ensure discount_info is set to null if it's not provided
            $priceData['discount_info'] = $priceData['discount_info'] ?? null;

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

    /**
     * Saves schedules related to an event.
     *
     * @param int $eventId
     * @param array $schedules
     * @return void
     */
    public function saveSchedules(int $eventId, array $schedules): void
    {
        foreach ($schedules as $scheduleData) {
            // Convert 'TBA' or empty strings to null
            $timeStart = $this->nullIfEmpty($scheduleData['time_start']);
            $timeEnd = $this->nullIfEmpty($scheduleData['time_end']);

            if (strtoupper($timeStart) === 'TBA') {
                $timeStart = null;
            }
            if (strtoupper($timeEnd) === 'TBA') {
                $timeEnd = null;
            }

            Schedule::updateOrCreate(
                [
                    'event_id' => $eventId,
                    'date' => $scheduleData['date'],
                ],
                [
                    'time_start' => $timeStart,
                    'time_end' => $timeEnd,
                    'special_notes' => $this->nullIfEmpty($scheduleData['special_notes']),
                ]
            );
        }
    }

    /**
     * Converts empty values to null.
     *
     * @param mixed $value
     * @return mixed|null
     */
    public function nullIfEmpty($value)
    {
        $value = trim($value);
        return (isset($value) && $value !== '' && strtoupper($value) !== 'TBA') ? $value : null;
    }
}
