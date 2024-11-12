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
    
        // Call OpenAI API to transform data
        $prompt = $this->constructPrompt($eventData);
        Log::info('Constructed OpenAI prompt', ['prompt' => $prompt]);
    
        $responseData = $this->callOpenAI($prompt);
    
        if (!empty($responseData) && isset($responseData['events'])) {
            Log::info('OpenAI response received', ['response_data' => $responseData]);
    
            foreach ($responseData['events'] as &$processedEvent) {
                // Add description and other fields from $eventData if they don't already exist
                $processedEvent['description'] = $eventData['description'] ?? null;
                $processedEvent['organization'] = $eventData['organization'] ?? null;
            }
            unset($processedEvent); // Break the reference to avoid potential issues
    
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
        // Constructing a detailed and precise prompt
        $prompt = "
        Transform the provided event data into the specified JSON format with the following requirements:

        1. **Date Parsing**:
        - Parse 'raw_date' into 'date_start' and 'date_end':
            - If 'raw_date' contains a date range in the format 'YYYY.MM.DD (DAY) – MM.DD (DAY)', extract:
            - 'date_start' as 'YYYY-MM-DD' from the first date,
            - 'date_end' as 'YYYY-MM-DD' using the same year as 'date_start', but replacing the month and day.
            - If 'raw_date' contains only a single date, set both 'date_start' and 'date_end' to the same value.
            - Ensure 'date_start' is not after 'date_end'.

        2. **Schedule Parsing**:
        - Parse 'raw_schedule' into an array of schedules:
            - Each schedule should include 'date', 'time_start', 'time_end', and 'special_notes'.
            - Use the date from 'raw_date' to populate the 'date' field for each schedule entry.
            - If 'raw_schedule' contains multiple entries on different days, separate them into individual schedule objects.
            - If 'time_end' is not specified, leave it empty.
        - If 'raw_schedule' is empty or unavailable, set 'schedule' as an empty array.

        3. **Category Assignment**:
        - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
            ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Tour', 'Festival', 'Family', 'Wellness', 'Sports'].

        4. **Tag Assignment**:
        - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
            ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event'].

        5. **Price Parsing**:
        - Extract pricing information from 'raw_price_text' and format it as an array of price objects:
            - Each price object should include 'price_tier', 'amount', and 'currency'.
            - 'price_tier' should represent the ticket type or seating type, including any relevant notes (e.g., 'General (1F)', 'S', '25 and Under', 'Repeat ticket').
            - 'amount' should be the numeric value of the price, excluding currency symbols (e.g., '6000', '4000').
            - Assume 'currency' to be 'JPY' if no currency is provided in 'raw_price_text'.
            - Include 'discount_info' if additional information about discounts or conditions is present in 'raw_price_text'.
            - If pricing varies by date, split these into separate price objects with the relevant details.
        - Example: For 'raw_price_text': 'General (1F): ¥6,000 / General (2F): ¥5,000 / 25 and Under: ¥3,000 / 18 and Under: ¥1,000', the output should be:
            [
                { \"price_tier\": \"General (1F)\", \"amount\": \"6000\", \"currency\": \"JPY\" },
                { \"price_tier\": \"General (2F)\", \"amount\": \"5000\", \"currency\": \"JPY\" },
                { \"price_tier\": \"25 and Under\", \"amount\": \"3000\", \"currency\": \"JPY\" },
                { \"price_tier\": \"18 and Under\", \"amount\": \"1000\", \"currency\": \"JPY\" }
            ].

            6. **Event Link Extraction**:
            - Ensure the 'event_link' is parsed from the provided data and included in the event object.
            - If an event link is present, set it as 'event_link' in the output. If no link is available, leave the field empty or set a placeholder to indicate it requires review.

        7. **Output Format**:
        - Ensure the output strictly follows the specified JSON format, even if some fields (e.g., 'categories', 'tags', 'prices') are empty:
            {
                \"events\": [
                    {
                        \"title\": \"Event Title\",
                        \"date_start\": \"YYYY-MM-DD\",
                        \"date_end\": \"YYYY-MM-DD\",
                        \"venue\": \"Venue Name\",
                        \"event_link\": \"Event URL\",
                        \"image_url\": \"Image URL\",
                        \"schedule\": [
                            {
                                \"date\": \"YYYY-MM-DD\",
                                \"time_start\": \"HH:mm:ss\",
                                \"time_end\": \"HH:mm:ss\",
                                \"special_notes\": \"Special Notes\"
                            }
                        ],
                        \"categories\": [\"Category1\", \"Category2\"],
                        \"tags\": [\"Tag1\", \"Tag2\"],
                        \"prices\": [
                            {
                                \"price_tier\": \"Tier1\",
                                \"amount\": \"1000\",
                                \"currency\": \"JPY\",
                                \"discount_info\": \"Discount Info\"
                            }
                        ]
                    }
                ]
            } 

        7. **Edge Case Handling**:
        - Handle any edge cases or unexpected formats gracefully, ensuring that the output structure remains consistent and valid.

        EVENT DATA TO BE PARSED: " . json_encode($eventData);

        return $prompt;
    }


    private function callOpenAI(string $prompt): ?array
{
    $apiKey = env('OPENAI_API_KEY');

    try {
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $apiKey,
        ])->post('https://api.openai.com/v1/chat/completions', [
            'model' => 'gpt-4o-mini',
            'messages' => [
                ['role' => 'user', 'content' => $prompt],
            ],
            'max_tokens' => 750,  // Adjust if needed
            'temperature' => 0.2,
        ]);

        $responseArray = $response->json();

        if (isset($responseArray['choices'][0]['message']['content'])) {
            // Get the content
            $parsedData = $responseArray['choices'][0]['message']['content'];
            
            // Use regex to extract JSON between braces
            if (preg_match('/\{(?:[^{}]|(?R))*\}/', $parsedData, $matches)) {
                $jsonContent = $matches[0];  // Extracted JSON string
                Log::info('Extracted JSON from OpenAI response', ['response' => $jsonContent]);

                // Decode the JSON
                return json_decode($jsonContent, true);
            }
        }
    } catch (\Exception $e) {
        Log::error('Error calling OpenAI API', ['error' => $e->getMessage()]);
    }

    return null;
}

    

private function processAndSaveEvent(array $eventData): void
{
    Log::info('Processing event data for saving', ['event_data' => $eventData]);

    // Generate external_id
    $eventData['external_id'] = md5("{$eventData['title']}_{$eventData['date_start']}_{$eventData['venue']}");
    Log::info('Generated external_id', ['external_id' => $eventData['external_id']]);

    $eventData['venue_id'] = $this->saveVenue($eventData) ?? null;
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
            $this->saveImages($event, $eventData['image_url'] ?? null, []);
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



private function saveVenue(array $eventData): ?int
{
    if (!empty($eventData['venue'])) {
        // Remove any variation of 'Venue:', case-insensitive, with optional spaces
        $cleanedVenueName = preg_replace('/^Venue\s*:\s*/i', '', $eventData['venue']);
        $cleanedVenueName = trim($cleanedVenueName);

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
            Log::warning('Venue name is empty after cleaning; venue data was not saved.', ['eventData' => $eventData]);
        }
    } else {
        Log::warning('Venue name is missing; venue data was not saved.', ['eventData' => $eventData]);
    }
    return null;
}


private function saveEvent(array $eventData): ?Event
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
        $this->saveImages($event, $eventData['image_url'] ?? null, []);
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
        'external_id' => 'required|string|unique:events,external_id',
    ]);

    if ($validator->fails()) {
        Log::error('Validation failed:', $validator->errors()->all());
        return false;
    }

    return true;
}


    private function saveSchedules(Event $event, array $schedules): void
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
