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
    public function transform(array $eventData): ?array
    {
        Log::info('Starting transformation process for Kyoto Gattaca event data', ['event_data' => $eventData]);

        // Dispatch the job for async processing, passing the transformer class and event data
        ProcessEventData::dispatch(static::class, $eventData);

        // Return immediately to prevent long processing in the HTTP request
        return null;
    }

    public function processEvent(array $eventData): void
    {
        Log::info('Processing event data for Kyoto Gattaca', ['event_data' => $eventData]);

        // Ensure the organization field is set to "Kyoto Gattaca"
        $eventData['organization'] = 'Kyoto Gattaca';

        // Generate a unique external ID
        $eventData['external_id'] = md5("{$eventData['title']}_{$eventData['date_start']}_{$eventData['venue']}");
        Log::info('Generated external ID', ['external_id' => $eventData['external_id']]);

        // Save or get the venue ID
        $eventData['venue_id'] = $this->saveVenue($eventData['venue']) ?? null;
        Log::info('Venue ID', ['venue_id' => $eventData['venue_id']]);

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
                $this->saveEventLink($event->id, $eventData['event_link']);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link']]);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    public function isValidEventData(array $eventData): bool
    {
        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
            'external_id' => 'required|string',
            'event_link' => 'required|string',
        ]);

        if ($validator->fails()) {
            Log::error('Validation failed', ['errors' => $validator->errors()->all(), 'event_data' => $eventData]);
            return false;
        }

        return true;
    }

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
                    'program' => $eventData['program'] ?? null,
                    'sold_out' => $eventData['sold_out'] ?? false,
                ]);

                $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
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

    public function constructPrompt(array $eventData): string
    {
        // Customize the prompt for Kyoto Gattaca events
        $eventJson = json_encode($eventData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        $prompt = <<<EOT
        Given the following JSON data extracted from Kyoto Gattaca's event page, parse and transform it into the specified JSON format. Return only the extracted data in **valid JSON format**. Do not include any comments, explanations, or additional text outside the JSON structure.

        Event Data:
        {$eventJson}

        **Extraction Requirements**:

        1. **Date Parsing**:
            - Extract 'date_start' and 'date_end' from the event data.
            - If only a single date is found, set both 'date_start' and 'date_end' to this value.
            - Format dates as 'YYYY-MM-DD'.

        2.  **Schedule Parsing**:
            - Identify any schedule details, including times if available.
            - If the time is 'TBA' or not specified, set `time_start` and `time_end` to null.
            - Construct a 'schedule' array with 'date', 'time_start', 'time_end', and 'special_notes' fields.

        3. **Category Assignment**:
            - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
                ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports'].
            
        4. **Tag Assignment**:
            - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
                ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event'].

        5. **Price Parsing**:
            - Locate any price information and generate an array of price objects.
            - Each price object should include 'price_tier', 'amount', 'currency' as 'JPY', and 'discount_info' if available.¥
            - If there is an advanced price and a door price, then separate these into different price tiers.
            - If price is set to 'TBA', return this as null.
            - If the event is free, set 'amount' to '0' and 'price_tier' to 'Free'.

        6. **Output Format**:
            - Return the extracted data in this JSON format, with an 'events' array containing one event object:
            {
                "events": [
                    {
                        "title": "Event Title",
                        "date_start": "YYYY-MM-DD",
                        "date_end": "YYYY-MM-DD",
                        "venue": "Kyoto Gattaca",
                        "organization": "Kyoto Gattaca",
                        "event_link": "Event link",
                        "image_url": "Image URL if available",
                        "schedule": [
                            {
                                "date": "YYYY-MM-DD",
                                "time_start": "HH:mm",
                                "time_end": "HH:mm",
                                "special_notes": "Any available notes"
                            }
                        ],
                        "categories": ["Category1", "Category2"],
                        "tags": ["Tag1", "Tag2"],
                        "prices": [
                            {
                                "price_tier": "Advance",
                                "amount": "2400",
                                "currency": "JPY",
                                "discount_info": "Student discount ¥500 off"
                            },
                            {
                                "price_tier": "Door",
                                "amount": "2900",
                                "currency": "JPY",
                                "discount_info": null
                            }
                        ],
                        "host": "Event organizer's name if available",
                        "ended": false,
                        "free": false
                    }
                ]
            }

        Parse the event data and structure it as instructed.

        EOT;

        Log::info('Constructed prompt for Kyoto Gattaca', ['prompt' => $prompt]);
        return $prompt;
    }

    public function callOpenAI(string $prompt): ?array
    {
        $apiKey = env('OPENAI_API_KEY');
        Log::info('Calling OpenAI API', ['prompt' => $prompt]);

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $apiKey,
            ])->post('https://api.openai.com/v1/chat/completions', [
                'model' => 'gpt-4o-mini', // Ensure you have access to GPT-4
                'messages' => [
                    ['role' => 'user', 'content' => $prompt],
                ],
                'max_tokens' => 2000,
                'temperature' => 0.2,
            ]);

            Log::info('OpenAI API response status', ['status' => $response->status()]);

            if ($response->status() == 429) {
                Log::warning('Rate limit hit. Retrying after delay.');
                sleep(5); // Wait before retrying
                return $this->callOpenAI($prompt); // Recursive retry
            }

            $responseArray = $response->json();

            Log::info('OpenAI API response', ['response' => $responseArray]);

            if (isset($responseArray['choices'][0]['message']['content'])) {
                // Get the content
                $parsedData = $responseArray['choices'][0]['message']['content'];

                Log::info('OpenAI API returned content', ['content' => $parsedData]);

                // Use regex to extract JSON between braces
                if (preg_match('/\{(?:[^{}]|(?R))*\}/s', $parsedData, $matches)) {
                    $jsonContent = $matches[0]; // Extracted JSON string
                    Log::info('Extracted JSON from OpenAI response', ['json_content' => $jsonContent]);

                    // Decode the JSON
                    $decodedData = json_decode($jsonContent, true);
                    if (json_last_error() === JSON_ERROR_NONE) {
                        return $decodedData;
                    } else {
                        Log::error('JSON decoding error', ['error' => json_last_error_msg()]);
                    }
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

    public function saveVenue(string $venueName): ?int
    {
        if (empty($venueName)) {
            return null;
        }

        $venue = Venue::firstOrCreate(['name' => $venueName]);
        return $venue->id;
    }

    public function saveEventLink(int $eventId, string $eventLink): void
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

    public function saveCategories(Event $event, array $categories): void
    {
        foreach ($categories as $categoryName) {
            $category = Category::firstOrCreate(['name' => $categoryName]);
            $event->categories()->syncWithoutDetaching([$category->id]);
        }
    }

    public function saveTags(Event $event, array $tags): void
    {
        foreach ($tags as $tagName) {
            $tag = Tag::firstOrCreate(['name' => $tagName]);
            $event->tags()->syncWithoutDetaching([$tag->id]);
        }
    }

    public function saveImages(Event $event, ?string $primaryImageUrl, array $images = [], ?string $eventLink = null): void
    {
        // Use a default image URL if no primary image URL is provided or if it's empty
        $defaultImageUrl = 'https://example.com/default-event-image.jpg'; // Replace with an appropriate default image URL

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

    public function nullIfEmpty($value)
    {
        $value = trim($value);
        return (isset($value) && $value !== '' && strtoupper($value) !== 'TBA') ? $value : null;
    }
}