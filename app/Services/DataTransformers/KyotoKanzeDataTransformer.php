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


class KyotoKanzeDataTransformer implements DataTransformerInterface
{
    public function transform(array $eventData): ?array
{
    Log::info('Starting transformation process for Kyoto Kanze event data', ['event_data' => $eventData]);

    // Remove `event_link` from $eventData before constructing the prompt
    $originalEventLink = $eventData['event_link'] ?? null;
    unset($eventData['event_link']);

    // Prepare data transformation using OpenAI or custom parsing logic
    $prompt = $this->constructPrompt($eventData);
    $responseData = $this->callOpenAI($prompt);

    if (!empty($responseData) && isset($responseData['events'])) {
        Log::info('OpenAI response received', ['response_data' => $responseData]);

        foreach ($responseData['events'] as &$processedEvent) {
            // Append the original `event_link` back to each event
            $processedEvent['event_link'] = $originalEventLink;

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

        // Ensure the organization field is set to "Kyoto Kanze"
        $eventData['organization'] = 'Kyoto Kanze';
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

    private function isValidEventData(array $eventData): bool
{
    $validator = Validator::make($eventData, [
        'title' => 'required|string',
        'date_start' => 'required|date',
        'date_end' => 'required|date',
        'external_id' => 'required|string|unique:events,external_id',
        'event_link' => 'required|string',
    ]);

    if ($validator->fails()) {
        Log::error('Validation failed:', $validator->errors()->all());
        return false;
    }

    return true;
}

private function saveEvent(array $eventData): ?Event
{
    try {
        Log::info('Creating or updating Kyoto Kanze event', ['event_data' => $eventData]);

        // Ensure 'external_id' is present
        if (!isset($eventData['external_id'])) {
            Log::warning('External ID missing for Kyoto Kanze event', ['event_data' => $eventData]);
            return null;
        }

        Log::info('Saving Kyoto Kanze event in updateOrCreate with external_id:', ['external_id' => $eventData['external_id']]);

        // Use 'external_id' to find and update the event, or create a new one
        $event = Event::updateOrCreate(
            ['external_id' => $eventData['external_id']], // Matching Attributes
            [ // Values to Update/Create
                'title' => $eventData['title'],
                'organization' => $eventData['organization'] ?? null,
                'description' => $eventData['description'] ?? 'No description available',
                'date_start' => $eventData['date_start'],
                'date_end' => $eventData['date_end'],
                'venue_id' => $eventData['venue_id'] ?? null,
                'program' => $eventData['program'] ?? null,
                'sold_out' => $eventData['sold_out'] ?? false,
            ]
        );

        Log::info('Kyoto Kanze event saved successfully', ['event_id' => $event->id]);

        // Save related data (if available)
        $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
        $this->saveCategories($event, $eventData['categories'] ?? []);
        $this->saveTags($event, $eventData['tags'] ?? []);
        
        // Handle image saving, using a default or null if 'image_url' is not provided
        $this->saveImages($event, $eventData['image_url'] ?? 'http://kyoto-kanze.jp/images/top002.jpg', [], $eventData['event_link'] ?? null);

        
        $this->savePrices($event->id, $eventData['prices'] ?? []);

        return $event;

    } catch (QueryException $qe) {
        Log::error('Database error while saving Kyoto Kanze event', [
            'error_message' => $qe->getMessage(),
            'sql' => $qe->getSql(),
            'bindings' => $qe->getBindings(),
            'event_data' => $eventData,
        ]);
    } catch (\Exception $e) {
        Log::error('Unexpected error while saving Kyoto Kanze event', [
            'error_message' => $e->getMessage(),
            'event_data' => $eventData,
        ]);
    }

    return null;
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
                $this->saveImages($event, $eventData['image_url'] ?? null, [], $eventData['event_link'] ?? null);
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
    if ($eventData['free'] ?? false) {
        // For free events, construct a prompt that includes $eventData
        $jsonEventData = json_encode($eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $prompt = <<<EOT
        Transform the provided event data into the specified JSON format with the following requirements:

        Event Data:
        {$jsonEventData}

        **Requirements**:

        1. **Date Parsing**:
        - Parse 'date_and_time' into 'date_start' and 'date_end':
            - Use 'YYYY-MM-DD' format for dates.
            - Extract the date from 'date_and_time', even if it contains day names or extra text.
            - If 'date_and_time' includes a time, extract 'time_start' and 'time_end' if applicable.

        2. **Schedule Parsing**:
        - Create a 'schedule' array with entries that include 'date', 'time_start', 'time_end', and 'special_notes'.
        - Use the parsed dates and times from 'date_and_time'. 

        3. **Price Parsing**:
        - Extract pricing information from 'price':
            - If the event is free (e.g., '無料'), set 'amount' to '0' and 'price_tier' to 'Free'.
            - Assume 'currency' to be 'JPY' if not specified.
          

        4. **Category Assignment**:
        - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
        ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports'].

        5. **Tag Assignment**:
        - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
        ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event'].

        6. **Output Format**:
        - Return the transformed data in the following JSON format:
        {
            "events": [
                {
                    "title": "Event Title",
                    "date_start": "YYYY-MM-DD",
                    "date_end": "YYYY-MM-DD",
                    "venue": "Kyoto Kanze",
                    "organization": "Kyoto Kanze",
                    "event_link": "Event link",
                    "image_url": "http://kyoto-kanze.jp/images/top002.jpg",
                    "schedule": [
                        {
                            "date": "YYYY-MM-DD",
                            "time_start": "HH:mm:ss",
                            "time_end": "HH:mm:ss",
                            "special_notes": "Any available notes"
                        }
                    ],
                    "categories": ["Category1", "Category2"],
                    "tags": ["Tag1", "Tag2"],
                    "prices": [
                        {
                            "price_tier": "Free",
                            "amount": "0",
                            "currency": "JPY",
                            "discount_info": null
                        }
                    ],
                    "host": "Event organizer's name",
                    "ended": false,
                    "free": true
                }
            ]
        }

        Please process the event data accordingly.
        EOT;

            } else {
                // For paid events, use the existing prompt with 'content_base_html'
                $contentBaseHTML = $eventData['content_base_html'] ?? '';  // Access the contentBase HTML

                $prompt = <<<EOT
        Extract structured event data from the following HTML content of a Kyoto Kanze event page. Parse this data into the specified JSON format and follow these requirements:

        HTML Content:
        {$contentBaseHTML}

        **Extraction Requirements**:

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
        ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports'].

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

        6. **Output Format**:
            - Return the extracted data in this JSON format, with an 'events' array containing one event object:
            {
                "events": [
                    {
                        "title": "Organisation Name - Extracted Event Title",
                        "date_start": "YYYY-MM-DD",
                        "date_end": "YYYY-MM-DD",
                        "venue": "Kyoto Kanze",
                        "organization": "Kyoto Kanze",
                        "event_link": "Event link",
                        "image_url": "Image URL if available or 'http://kyoto-kanze.jp/images/top002.jpg' as a default",
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
                                "price_tier": "Tier1",
                                "amount": "1000",
                                "currency": "JPY",
                                "discount_info": "Discount information if available"
                            }
                        ],
                        "host": "Event organizer's name",
                        "ended": false,
                        "free": true or false based on the price tier
                    }
                ]
            }


        Parse the HTML content and structure it as instructed.
        EOT;
            }

    Log::info('Constructed prompt for Kyoto Kanze', ['prompt' => $prompt]);
    return $prompt;
}

    



       

    // Define additional helper methods like saveSchedules, saveVenue, saveEventLink, etc.


    private function callOpenAI(string $prompt): ?array
    {
        $apiKey = env('OPENAI_API_KEY');
    
        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $apiKey,
            ])->post('https://api.openai.com/v1/chat/completions', [
                'model' => 'gpt-4o-mini',  // Correct model name
                'messages' => [
                    ['role' => 'user', 'content' => $prompt],
                ],
                'max_tokens' => 1000,  // Adjust if needed
                'temperature' => 0.2,
            ]);
    
            // Handle rate limits or other transient errors
            if ($response->status() == 429) {
                Log::warning('Rate limit hit. Retrying after delay.');
                sleep(5); // Wait before retrying
                return $this->callOpenAI($prompt); // Recursive retry
            }
    
            $responseArray = $response->json();
    
            if (isset($responseArray['choices'][0]['message']['content'])) {
                // Get the content
                $parsedData = $responseArray['choices'][0]['message']['content'];
                
                // Use regex to extract JSON between braces
                if (preg_match('/\{(?:[^{}]|(?R))*\}/s', $parsedData, $matches)) {
                    $jsonContent = $matches[0];  // Extracted JSON string
                    Log::info('Extracted JSON from OpenAI response', ['response' => $jsonContent]);
    
                    // Decode the JSON
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


// Save schedules to the database
private function saveSchedules(int $eventId, array $schedules): void
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

private function saveImages(Event $event, ?string $primaryImageUrl, array $images = [], ?string $eventLink = null): void
{
    // Use the default image URL if no primary image URL is provided or if it's empty
    $primaryImageUrl = $primaryImageUrl ?: 'http://kyoto-kanze.jp/images/top002.jpg';

    // Ensure primary image URL has event link prepended if it starts with "./"
    if ($eventLink && strpos($primaryImageUrl, './') === 0) {
        $primaryImageUrl = ltrim($primaryImageUrl, './');
        $primaryImageUrl = rtrim($eventLink, '/') . '/' . $primaryImageUrl;

        // Log the updated primary image URL
        Log::info('Primary image URL updated with event link', [
            'updated_primary_image_url' => $primaryImageUrl,
            'event_id' => $event->id,
            'event_link' => $eventLink
        ]);
    }

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
            // Ensure additional image URLs have event link prepended if they start with "./"
            if ($eventLink && strpos($imageUrl, './') === 0) {
                $imageUrl = ltrim($imageUrl, './');
                $imageUrl = rtrim($eventLink, '/') . '/' . $imageUrl;
            }

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





    

    private function savePrices(int $eventId, array $prices): void
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
    

// Helper function to handle null values for empty strings
private function nullIfEmpty($value)
{
    return isset($value) && $value !== '' ? $value : null;
}


}