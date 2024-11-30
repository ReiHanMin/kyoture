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
use Illuminate\Support\Facades\Validator;
use Illuminate\Database\QueryException;
use App\Services\ImageHelper; // Assuming centralized ImageHelper exists

class RohmTheatreDataTransformer implements DataTransformerInterface
{
    /**
     * Dispatches the event data processing job.
     *
     * @param array $eventData
     * @return array|null
     */
    public function transform(array $eventData): ?array
    {
        Log::info('Dispatching job for Rohm Theatre event data', ['event_data' => $eventData]);

        // Generate external_id based on event_link
        if (isset($eventData['event_link'])) {
            $eventData['external_id'] = md5($eventData['event_link']);
        } else {
            Log::warning('event_link missing in event data', ['event_data' => $eventData]);
            // Handle missing event_link appropriately
            $eventData['external_id'] = md5(uniqid('', true)); // Generate a unique ID
        }

        // Dispatch the job, passing the transformer class name and event data
        \App\Jobs\ProcessEventData::dispatch(static::class, $eventData);

        // Return immediately to prevent long processing in the HTTP request
        return null;
    }

    /**
     * Processes the event data by transforming and saving it.
     *
     * @param array $eventData
     * @return array|null
     */
    public function processEvent(array $eventData): ?array
    {
        Log::info('Starting transformation process for Rohm Theatre event data', ['event_data' => $eventData]);

        // Store original values
        $originalEventLink = $eventData['event_link'] ?? null;
        $originalExternalId = $eventData['external_id'] ?? null;

        // Remove `event_link` and `external_id` from $eventData before constructing the prompt
        unset($eventData['event_link'], $eventData['external_id']);

        // Prepare data transformation using OpenAI or custom parsing logic
        $prompt = $this->constructPrompt($eventData);
        Log::info('Constructed OpenAI prompt', ['prompt' => $prompt]);

        $responseData = $this->callOpenAI($prompt);

        if (!empty($responseData) && isset($responseData['events'])) {
            Log::info('OpenAI response received', ['response_data' => $responseData]);

            foreach ($responseData['events'] as &$processedEvent) {
                // Reattach the original `event_link` and `external_id`
                $processedEvent['event_link'] = $originalEventLink;
                $processedEvent['external_id'] = $originalExternalId;

                // Add description and other fields from $eventData if they don't already exist
                $processedEvent['description'] = $eventData['description'] ?? null;
                $processedEvent['organization'] = $eventData['organization'] ?? null;

                // Ensure image_url is present; if not, set to placeholder
                if (isset($processedEvent['image_url']) && !empty($processedEvent['image_url'])) {
                    // Assume it's already a relative path from the scraper
                } else {
                    // Assign a default placeholder if image_url is missing
                    $processedEvent['image_url'] = '/images/events/placeholder.jpg';
                }

                $this->processAndSaveEvent($processedEvent);
            }
            unset($processedEvent); // Break the reference

            return $responseData;
        }

        Log::warning('API response is empty or malformed.', ['response' => $responseData]);
        return null;
    }

    /**
     * Constructs the prompt for OpenAI API based on event data.
     *
     * @param array $eventData
     * @return string
     */
    public function constructPrompt(array $eventData): string
    {
        if (empty($eventData)) {
            Log::warning('Empty event data provided to constructPrompt.');
            return "No event data provided.";
        }

        $jsonEventData = json_encode($eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($jsonEventData === false) {
            Log::error('Failed to JSON encode event data.', ['event_data' => $eventData]);
            return "Invalid event data provided.";
        }

        $prompt = <<<EOT
Transform the provided event data into the specified JSON format with the following requirements:

1. **Date Parsing**:
   - Set 'date_start' and 'date_end':
     - Use 'YYYY-MM-DD' format for dates.

2. **Schedule Parsing**:
   - Create a 'schedule' array with entries that include 'date', 'time_start', 'time_end', and 'special_notes'.

3. **Category Assignment**:
   - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
       ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports'].

4. **Tag Assignment**:
   - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
       ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event'].

5. **Price Parsing**:
   - Parse information from the 'prices' array.
   - Each price should include:
     - 'price_tier': the description or category of the price (e.g., "Adults").
     - 'amount': the numerical amount, formatted as a string (e.g., "7000").
     - 'currency': use "JPY" for Japanese Yen.
     - 'discount_info': include any available discount details. If no discount information is provided, set 'discount_info' to null.

6. **Event Link Extraction**:
   - Ensure the 'event_link' is parsed from the provided data and included in the event object.
   - If an event link is present, set it as 'event_link' in the output. If no link is available, leave the field empty or set a placeholder to indicate it requires review.

7. **Output Format**:
   - Ensure the output strictly follows the specified JSON format:
     {
       "events": [
         {
           "title": "Event Title",
           "date_start": "YYYY-MM-DD",
           "date_end": "YYYY-MM-DD",
           "venue": "Venue Name",
           "organization": "Organization Name",
           "event_link": "Event URL",
           "image_url": "Image URL",
           "schedule": [
             {
               "date": "YYYY-MM-DD",
               "time_start": "HH:mm:ss",
               "time_end": "HH:mm:ss",
               "special_notes": "Special Notes"
             }
           ],
           "categories": ["Category1", "Category2"],
           "tags": ["Tag1", "Tag2"],
           "prices": [
             {
               "price_tier": "Adults",
               "amount": "1000",
               "currency": "JPY",
               "discount_info": "Discount Info"
             }
           ],
           "free": false
         }
       ]
     }

EVENT DATA TO BE PARSED: {$jsonEventData}
EOT;

        Log::info('Constructed prompt:', ['prompt' => $prompt]);

        return $prompt;
    }

    /**
     * Calls the OpenAI API with the constructed prompt.
     *
     * @param string $prompt
     * @return array|null
     */
    public function callOpenAI(string $prompt): ?array
    {
        $apiKey = env('OPENAI_API_KEY');

        // Avoid logging sensitive information
        // Log::info('OpenAI API Key:', ['key' => $apiKey]); // Remove or comment out this line

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $apiKey,
                'Content-Type' => 'application/json',
            ])->post('https://api.openai.com/v1/chat/completions', [
                'model' => 'gpt-4', // Ensure you have access to GPT-4
                'messages' => [
                    ['role' => 'user', 'content' => $prompt],
                ],
                'max_tokens' => 2000, // Adjust if needed
                'temperature' => 0.2,
            ]);

            if ($response->status() == 429) {
                Log::warning('Rate limit hit. Retrying after delay.');
                sleep(5);
                return $this->callOpenAI($prompt);
            }

            $responseArray = $response->json();

            if (isset($responseArray['choices'][0]['message']['content'])) {
                $parsedData = $responseArray['choices'][0]['message']['content'];

                if (preg_match('/\{(?:[^{}]|(?R))*\}/s', $parsedData, $matches)) {
                    $jsonContent = $matches[0];
                    Log::info('Extracted JSON from OpenAI response', ['response' => $jsonContent]);
                    return json_decode($jsonContent, true);
                } else {
                    Log::warning('No JSON found in OpenAI response', ['response' => $parsedData]);
                }
            } else {
                Log::warning('No content in OpenAI response', ['response' => $responseArray]);
            }
        } catch (\Exception $e) {
            Log::error('Error calling OpenAI API', ['error' => $e->getMessage()]);
        }

        return null;
    }

    /**
     * Processes and saves the event data into the database.
     *
     * @param array $eventData
     * @return void
     */
    public function processAndSaveEvent(array $eventData): void
    {
        Log::info('Processing event data for saving', ['event_data' => $eventData]);

        // Ensure external_id is present
        if (!isset($eventData['external_id'])) {
            Log::warning('External ID missing for event', ['event_data' => $eventData]);
            return;
        }

        $eventData['venue_id'] = $this->saveVenue($eventData['venue'] ?? null);
        Log::info('Venue ID assigned', ['venue_id' => $eventData['venue_id']]);

        if ($this->isValidEventData($eventData)) {
            // Check if the event already exists based on external_id
            $existingEvent = Event::where('external_id', $eventData['external_id'])->first();

            if ($existingEvent) {
                // Update the existing event
                $event = $this->updateEvent($existingEvent->id, $eventData);
                Log::info('Existing event updated', ['event_id' => $event->id]);
            } else {
                // Create a new event
                $event = $this->saveEvent($eventData);
                Log::info('New event created', ['event_id' => $event->id]);
            }

            if ($event) {
                $this->saveEventLink($event->id, $eventData['event_link'] ?? null);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link'] ?? null]);

                // Save related data
                $this->saveSchedules($event, $eventData['schedule'] ?? []);
                $this->saveCategoriesAndTags($event, $eventData);
                $this->saveImages($event, $eventData['image_url'] ?? null, $eventData['additional_images'] ?? []);
                $this->savePrices($event, $eventData['prices'] ?? []);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    /**
     * Updates an existing event with new data.
     *
     * @param int $eventId
     * @param array $eventData
     * @return Event|null
     */
    public function updateEvent(int $eventId, array $eventData): ?Event
    {
        try {
            Log::info('Updating existing event', ['event_id' => $eventId]);

            $event = Event::find($eventId);

            if ($event) {
                $event->update([
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'] ?? null,
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    // 'external_id' remains unchanged
                ]);

                // Update related data
                $this->saveSchedules($event, $eventData['schedule'] ?? []);
                $this->saveCategoriesAndTags($event, $eventData);
                $this->saveImages($event, $eventData['image_url'] ?? null, $eventData['additional_images'] ?? []);
                $this->savePrices($event, $eventData['prices'] ?? []);

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

    /**
     * Saves or retrieves a venue based on the provided name.
     *
     * @param string|null $venueName
     * @return int|null
     */
    public function saveVenue(?string $venueName): ?int
    {
        if (!empty($venueName)) {
            // Clean the venue name
            $cleanedVenueName = trim($venueName);

            if (!empty($cleanedVenueName)) {
                Log::info('Saving or retrieving venue', ['venue_name' => $cleanedVenueName]);

                $venue = Venue::firstOrCreate(
                    ['name' => $cleanedVenueName],
                    [
                        'address' => $eventData['address'] ?? null,
                        'city' => $eventData['city'] ?? null,
                        'postal_code' => $eventData['postal_code'] ?? null,
                        'country' => $eventData['country'] ?? null,
                    ]
                );

                Log::info('Venue saved or retrieved', ['venue_id' => $venue->id]);
                return $venue->id;
            } else {
                Log::warning('Venue name is empty after cleaning; venue data was not saved.', ['venueName' => $venueName]);
            }
        } else {
            Log::warning('Venue name is missing; venue data was not saved.', ['eventData' => $eventData]);
        }
        return null;
    }

    /**
     * Saves a new event to the database.
     *
     * @param array $eventData
     * @return Event|null
     */
    public function saveEvent(array $eventData): ?Event
    {
        try {
            Log::info('Creating new event', ['event_data' => $eventData]);

            $event = Event::create([
                'title' => $eventData['title'],
                'organization' => $eventData['organization'] ?? null,
                'description' => $eventData['description'] ?? null,
                'date_start' => $eventData['date_start'],
                'date_end' => $eventData['date_end'],
                'venue_id' => $eventData['venue_id'],
                'external_id' => $eventData['external_id'], // Include external_id
            ]);

            Log::info('Event saved successfully', ['event_id' => $event->id]);

            // Save related data
            $this->saveSchedules($event, $eventData['schedule'] ?? []);
            $this->saveCategoriesAndTags($event, $eventData);
            $this->saveImages($event, $eventData['image_url'] ?? null, $eventData['additional_images'] ?? []);
            $this->savePrices($event, $eventData['prices'] ?? []);

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

    /**
     * Validates the event data.
     *
     * @param array $eventData
     * @return bool
     */
    public function isValidEventData(array $eventData): bool
    {
        Log::info('Checking type of $eventData', ['type' => gettype($eventData)]);

        // Check if $eventData is indeed an array
        if (!is_array($eventData)) {
            Log::error('Expected $eventData to be an array, but it is not.', ['event_data' => $eventData]);
            return false;
        }

        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
            'external_id' => 'required|string',
            'event_link' => 'required|string',
        ]);

        if ($validator->fails()) {
            Log::error('Validation failed:', $validator->errors()->all());
            return false;
        }

        return true;
    }

    /**
     * Saves schedules related to an event.
     *
     * @param Event $event
     * @param array $schedules
     * @return void
     */
    public function saveSchedules(Event $event, array $schedules): void
    {
        foreach ($schedules as $schedule) {
            $time_start = !empty($schedule['time_start']) ? $schedule['time_start'] : null;
            $time_end = !empty($schedule['time_end']) ? $schedule['time_end'] : null;

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

    /**
     * Saves categories and tags related to an event.
     *
     * @param Event $event
     * @param array $eventData
     * @return void
     */
    public function saveCategoriesAndTags(Event $event, array $eventData): void
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

    /**
     * Saves images related to an event.
     *
     * @param Event $event
     * @param string|null $primaryImageUrl
     * @param array $images
     * @return void
     */
    public function saveImages(Event $event, ?string $primaryImageUrl, array $images): void
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

    /**
     * Saves prices related to an event.
     *
     * @param Event $event
     * @param array $prices
     * @return void
     */
    public function savePrices(Event $event, array $prices): void
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
                ['event_id' => $eventId, 'url' => $eventLink],
                ['link_type' => 'primary']
            );
        } else {
            Log::warning('Event link is missing; skipping EventLink save.', ['event_id' => $eventId]);
        }
    }
}
